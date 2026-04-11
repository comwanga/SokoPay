//! Payment expiry background worker.
//!
//! Runs every 60 seconds. If a buyer requests an invoice but never pays,
//! this worker cleans up after 15 minutes:
//!   1. Marks the payment as expired.
//!   2. Cancels the order if it is still waiting for payment.
//!   3. Puts the stock back so someone else can buy the item.
//!   4. Records a cancellation entry in the order history.

use sqlx::PgPool;
use std::time::Duration;

const POLL_INTERVAL_SECS: u64 = 60;

pub async fn run(pool: PgPool) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    // Miss-fire policy: if the tick fires late we skip the missed ones rather
    // than bursting. This avoids a stampede after a startup delay.
    // Skip missed ticks instead of running multiple times after a delay.
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        match expire_payments(&pool).await {
            Ok(n) if n > 0 => tracing::info!("payment_expiry: expired {} payment(s)", n),
            Ok(_) => {}
            Err(e) => tracing::error!("payment_expiry: error during sweep: {}", e),
        }
    }
}

/// Finds all payments that are overdue and handles them in one database operation.
/// Returns how many payments were expired.
async fn expire_payments(pool: &PgPool) -> Result<u64, sqlx::Error> {
    // One atomic statement:
    //  a) mark payments expired
    //  b) cancel the corresponding orders (only if still pending_payment)
    //  c) restore stock for those orders
    //  d) insert audit events
    let result = sqlx::query(
        r#"
        WITH expired_payments AS (
            UPDATE payments
            SET    status = 'expired'
            WHERE  status = 'pending'
              AND  expires_at <= NOW()
            RETURNING id, order_id
        ),
        cancelled_orders AS (
            UPDATE orders o
            SET    status = 'cancelled',
                   updated_at = NOW()
            FROM   expired_payments ep
            WHERE  o.id = ep.order_id
              AND  o.status = 'pending_payment'
            RETURNING o.id AS order_id, o.product_id, o.quantity
        ),
        restored_stock AS (
            UPDATE products p
            SET    quantity_avail = p.quantity_avail + co.quantity
            FROM   cancelled_orders co
            WHERE  p.id = co.product_id
        )
        INSERT INTO order_events (order_id, event_type, metadata)
        SELECT order_id,
               'cancelled',
               '{"reason": "payment_expired"}'::jsonb
        FROM   cancelled_orders
        "#,
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}
