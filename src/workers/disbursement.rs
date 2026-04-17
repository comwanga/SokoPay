//! Disbursement reconciliation worker.
//!
//! Polls every 10 minutes for disbursements that have been in `pending` or
//! `processing` state for longer than 15 minutes without receiving a Daraja
//! B2C callback. These rows are marked `manual_required` so the finance team
//! can investigate and retry via the Safaricom portal.
//!
//! Why 15 minutes? Daraja's documented B2C processing SLA is <5 minutes in
//! normal conditions. If we haven't heard back after 15 minutes, either the
//! callback URL was unreachable (missed webhook) or Daraja has an issue.
//! We surface the row rather than silently waiting indefinitely.

use crate::state::SharedState;
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_secs(10 * 60); // 10 min
const STALE_THRESHOLD_MINUTES: i64 = 15;

pub async fn run(state: SharedState) {
    tracing::info!(
        poll_interval_secs = POLL_INTERVAL.as_secs(),
        stale_threshold_minutes = STALE_THRESHOLD_MINUTES,
        "Disbursement reconciliation worker started"
    );

    loop {
        tokio::time::sleep(POLL_INTERVAL).await;

        if let Err(e) = reconcile_stale_disbursements(&state).await {
            tracing::error!(error = %e, "Disbursement reconciliation cycle failed");
        }
    }
}

async fn reconcile_stale_disbursements(state: &SharedState) -> Result<(), sqlx::Error> {
    // Find disbursements stuck in pending/processing beyond the stale threshold.
    // These are rows where Daraja either never responded or the callback was
    // dropped (network issue, misconfigured URL, etc.).
    let stale_ids: Vec<(uuid::Uuid,)> = sqlx::query_as(
        "SELECT id FROM disbursements
         WHERE status IN ('pending', 'processing')
           AND initiated_at < NOW() - ($1 || ' minutes')::INTERVAL",
    )
    .bind(STALE_THRESHOLD_MINUTES)
    .fetch_all(&state.db)
    .await?;

    if stale_ids.is_empty() {
        return Ok(());
    }

    tracing::warn!(
        count = stale_ids.len(),
        "Found stale disbursements — marking manual_required"
    );

    for (id,) in &stale_ids {
        let result = sqlx::query(
            "UPDATE disbursements
             SET status = 'manual_required',
                 notes  = COALESCE(notes || ' | ', '') ||
                          'No B2C callback received within 15 min — check Safaricom portal'
             WHERE id = $1 AND status IN ('pending', 'processing')",
        )
        .bind(id)
        .execute(&state.db)
        .await;

        match result {
            Ok(_) => {
                tracing::warn!(
                    disbursement_id = %id,
                    "Stale disbursement marked manual_required"
                );
            }
            Err(e) => {
                tracing::error!(
                    disbursement_id = %id,
                    error = %e,
                    "Failed to mark stale disbursement"
                );
            }
        }
    }

    Ok(())
}
