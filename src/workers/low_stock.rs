//! Low-stock alert worker.
//!
//! Runs every 10 minutes. For every product where:
//!   • `low_stock_threshold` is set, AND
//!   • `quantity_avail <= low_stock_threshold`, AND
//!   • the last alert was sent more than 24 hours ago (or never)
//!
//! it notifies the seller via Nostr DM and SMS, then stamps `last_low_stock_alert_at`.

use crate::state::SharedState;
use std::time::Duration;

const POLL_INTERVAL_SECS: u64 = 600; // 10 minutes
const ALERT_COOLDOWN_HOURS: i64 = 24;

pub async fn run(state: SharedState) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        match send_low_stock_alerts(&state).await {
            Ok(n) if n > 0 => tracing::info!("low_stock: sent {} alert(s)", n),
            Ok(_) => {}
            Err(e) => tracing::error!("low_stock: error during sweep: {}", e),
        }
    }
}

async fn send_low_stock_alerts(state: &SharedState) -> Result<u64, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct LowStockRow {
        product_id: uuid::Uuid,
        title: String,
        quantity_avail: rust_decimal::Decimal,
        low_stock_threshold: rust_decimal::Decimal,
        seller_id: uuid::Uuid,
        nostr_pubkey: Option<String>,
        phone: Option<String>,
    }

    let rows: Vec<LowStockRow> = sqlx::query_as(
        r#"
        SELECT p.id AS product_id, p.title,
               p.quantity_avail, p.low_stock_threshold,
               p.seller_id, f.nostr_pubkey, f.phone
        FROM products p
        JOIN farmers f ON f.id = p.seller_id
        WHERE p.low_stock_threshold IS NOT NULL
          AND p.quantity_avail <= p.low_stock_threshold
          AND p.status = 'active'
          AND (
              p.last_low_stock_alert_at IS NULL
              OR p.last_low_stock_alert_at < NOW() - ($1 || ' hours')::interval
          )
        "#,
    )
    .bind(ALERT_COOLDOWN_HOURS)
    .fetch_all(&state.db)
    .await?;

    let count = rows.len() as u64;

    for row in rows {
        // Stamp the alert time first so a crash in notification doesn't cause a spam loop.
        let _ = sqlx::query("UPDATE products SET last_low_stock_alert_at = NOW() WHERE id = $1")
            .bind(row.product_id)
            .execute(&state.db)
            .await;

        let msg = format!(
            "⚠️ Low stock: \"{}\" has only {} units left (threshold: {}). Top up your listing on SokoPay.",
            row.title, row.quantity_avail, row.low_stock_threshold
        );

        // Nostr DM (fire-and-forget)
        if let Some(ref pubkey) = row.nostr_pubkey {
            let config = state.config.clone();
            let pubkey = pubkey.clone();
            let msg2 = msg.clone();
            tokio::spawn(async move {
                crate::notifications::nostr_dm::send_dm(&config, &pubkey, &msg2).await;
            });
        }

        // SMS via Africa's Talking (fire-and-forget)
        if let Some(ref phone) = row.phone {
            let config = state.config.clone();
            let http = state.http.clone();
            let phone = phone.clone();
            let msg3 = msg.clone();
            tokio::spawn(async move {
                let res = crate::notifications::sms::send(&http, &config, &phone, &msg3).await;
                if let Err(e) = res {
                    tracing::warn!("low_stock: SMS failed: {}", e);
                }
            });
        }

        tracing::info!(
            product_id = %row.product_id,
            seller_id = %row.seller_id,
            qty = %row.quantity_avail,
            threshold = %row.low_stock_threshold,
            "low_stock alert sent"
        );
    }

    Ok(count)
}
