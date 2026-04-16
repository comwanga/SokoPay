//! Dispute timeout background worker.
//!
//! Runs once per day. If a dispute has been open for more than 7 days with no
//! admin action, it is auto-resolved in favour of the seller (`release_seller`).
//! The assumption is that if the buyer had a legitimate claim they would have
//! escalated within a week; lingering disputes block seller funds indefinitely.
//!
//! The outcome is recorded in `order_events` so admins can audit it.

use crate::state::SharedState;
use std::time::Duration;

const POLL_INTERVAL_SECS: u64 = 86_400; // 24 hours
const DISPUTE_TIMEOUT_DAYS: i64 = 7;

pub async fn run(state: SharedState) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
    // Skip missed ticks — if the process was down, we don't need to backfill.
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;
        match auto_resolve_stale_disputes(&state).await {
            Ok(0) => {}
            Ok(n) => tracing::info!("dispute_timeout: auto-resolved {} stale dispute(s)", n),
            Err(e) => tracing::error!("dispute_timeout: error during sweep: {}", e),
        }
    }
}

async fn auto_resolve_stale_disputes(state: &SharedState) -> Result<u64, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct StaleRow {
        id: uuid::Uuid,
    }

    let stale: Vec<StaleRow> = sqlx::query_as(
        "SELECT id FROM orders
         WHERE status = 'disputed'
           AND dispute_opened_at < NOW() - ($1 || ' days')::INTERVAL",
    )
    .bind(DISPUTE_TIMEOUT_DAYS)
    .fetch_all(&state.db)
    .await?;

    if stale.is_empty() {
        return Ok(0);
    }

    let now = chrono::Utc::now();
    let mut resolved: u64 = 0;

    for row in stale {
        let order_id = row.id;

        let updated = sqlx::query(
            "UPDATE orders
             SET status              = 'confirmed',
                 dispute_resolution  = 'release_seller',
                 dispute_resolved_at = $2,
                 updated_at          = $2
             WHERE id = $1 AND status = 'disputed'",
        )
        .bind(order_id)
        .bind(now)
        .execute(&state.db)
        .await?;

        if updated.rows_affected() > 0 {
            resolved += 1;

            let _ = crate::events::record_order_event(
                &state.db,
                order_id,
                None,
                "dispute_resolved",
                Some("Auto-resolved after 7-day timeout — no admin action taken"),
                serde_json::json!({
                    "resolution":    "release_seller",
                    "final_status":  "confirmed",
                    "auto_timeout":  true,
                }),
            )
            .await;

            tracing::info!(
                order_id = %order_id,
                "Stale dispute auto-resolved (release_seller) after {}-day timeout",
                DISPUTE_TIMEOUT_DAYS
            );
        }
    }

    Ok(resolved)
}
