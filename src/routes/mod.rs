mod dashboard;
mod farmers;
pub mod middleware;
mod oracle;
mod payments;
mod webhooks;

use crate::state::SharedState;
use axum::{
    middleware as axum_middleware,
    routing::{get, post},
    Router,
};
use tower::limit::ConcurrencyLimitLayer;

pub fn router(state: SharedState) -> Router<SharedState> {
    // ── Protected API routes (require X-Api-Key when configured) ────────────
    let protected = Router::new()
        .route("/health", get(health))
        .route("/dashboard/stats", get(dashboard::stats))
        .route("/farmers", get(farmers::list).post(farmers::create))
        .route("/farmers/:id", get(farmers::get_one))
        .route("/oracle/rate", get(oracle::current_rate))
        .route("/payments", get(payments::list).post(payments::create))
        .route("/payments/:id", get(payments::get_one))
        .route("/payments/:id/disburse", post(payments::disburse))
        .layer(axum_middleware::from_fn_with_state(
            state,
            middleware::require_api_key,
        ));

    // ── Webhook routes (no API key; authenticated via :secret in path) ───────
    // The secret is embedded into the callback URL registered with Safaricom.
    // Safaricom sends no auth header; we validate the secret path segment instead.
    let webhooks = Router::new()
        .route(
            "/webhooks/mpesa/:secret/result",
            post(webhooks::mpesa_result),
        )
        .route(
            "/webhooks/mpesa/:secret/timeout",
            post(webhooks::mpesa_timeout),
        );

    Router::new()
        .merge(protected)
        .merge(webhooks)
        // Limit concurrent in-flight requests to guard against resource exhaustion.
        .layer(ConcurrencyLimitLayer::new(200))
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION")
    }))
}
