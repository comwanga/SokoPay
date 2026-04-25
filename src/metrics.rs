//! Application-level business metrics exposed in Prometheus text format.
//!
//! HTTP request metrics (latency, status codes) are handled by the TraceLayer in
//! main.rs.  This module tracks the business events that matter for ops alerting:
//! order volume, payment success rate, disbursement health, and SMS delivery.
//!
//! Usage:
//!   1. Call `init()` once at startup — installs the global Prometheus recorder.
//!   2. Call the `record_*` helpers at the relevant business events.
//!   3. GET /api/metrics returns the text/plain Prometheus scrape payload.

use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};

/// Install the global Prometheus recorder and return the render handle.
///
/// Must be called before any `metrics::counter!` / `metrics::gauge!` calls to
/// ensure they land in the same registry that `handle.render()` reads from.
pub fn init() -> anyhow::Result<PrometheusHandle> {
    let handle = PrometheusBuilder::new()
        .install_recorder()
        .map_err(|e| anyhow::anyhow!("Failed to install Prometheus recorder: {}", e))?;
    Ok(handle)
}

// ── Business metric helpers ───────────────────────────────────────────────────

/// A new order was placed by a buyer.
pub fn record_order_created() {
    metrics::counter!("sokopay_orders_created_total").increment(1);
}

/// A buyer confirmed delivery of an order (the final "paid + delivered" step).
pub fn record_order_confirmed() {
    metrics::counter!("sokopay_orders_confirmed_total").increment(1);
}

/// A B2C disbursement was successfully paid to a seller.
pub fn record_disbursement_paid() {
    metrics::counter!("sokopay_disbursements_paid_total").increment(1);
}

/// A B2C disbursement failed.
pub fn record_disbursement_failed() {
    metrics::counter!("sokopay_disbursements_failed_total").increment(1);
}

/// A dispute was opened by a buyer.
pub fn record_dispute_opened() {
    metrics::gauge!("sokopay_open_disputes").increment(1.0);
}

/// A dispute was resolved (any outcome).
pub fn record_dispute_resolved() {
    metrics::gauge!("sokopay_open_disputes").decrement(1.0);
}

/// An SMS notification was sent via Africa's Talking.
pub fn record_sms_sent(ok: bool) {
    let status = if ok { "ok" } else { "error" };
    metrics::counter!("sokopay_sms_sent_total", "status" => status).increment(1);
}

/// An M-Pesa STK Push was initiated.
#[allow(dead_code)]
pub fn record_stk_push_initiated() {
    metrics::counter!("sokopay_stk_push_initiated_total").increment(1);
}

/// Seconds between B2C disbursement initiation and Daraja's result callback.
pub fn record_disbursement_processing(seconds: f64) {
    metrics::histogram!("sokopay_disbursement_processing_seconds").record(seconds);
}
