use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};
use crate::error::AppResult;
use crate::state::SharedState;

pub async fn current_rate(State(state): State<SharedState>) -> AppResult<Json<Value>> {
    // B-6: honour rate_cache_seconds — only fetch live if the cache is stale.
    if let Some(cached) = state.db.get_cached_rate().await {
        let age_secs = chrono::Utc::now()
            .signed_duration_since(
                chrono::DateTime::parse_from_rfc3339(&cached.fetched_at)
                    .or_else(|_| {
                        chrono::NaiveDateTime::parse_from_str(&cached.fetched_at, "%Y-%m-%d %H:%M:%S")
                            .map(|ndt| ndt.and_utc().fixed_offset())
                    })
                    .unwrap_or_else(|_| chrono::DateTime::UNIX_EPOCH.fixed_offset()),
            )
            .num_seconds()
            .unsigned_abs();

        if age_secs < state.oracle.cache_ttl_secs() {
            return Ok(Json(json!({
                "btc_kes": cached.btc_kes,
                "btc_usd": cached.btc_usd,
                "source": "cache",
                "live": false,
                "fetched_at": cached.fetched_at,
            })));
        }
    }

    // Cache is missing or stale — fetch live.
    match state.oracle.fetch_rate().await {
        Ok(rate) => {
            state.db.upsert_rate(rate.btc_kes, rate.btc_usd).await.ok();
            Ok(Json(json!({
                "btc_kes": rate.btc_kes,
                "btc_usd": rate.btc_usd,
                "source": "coingecko",
                "live": true,
            })))
        }
        Err(e) => {
            tracing::warn!("Live rate fetch failed: {}; falling back to stale cache", e);
            match state.db.get_cached_rate().await {
                Some(c) => Ok(Json(json!({
                    "btc_kes": c.btc_kes,
                    "btc_usd": c.btc_usd,
                    "source": "cache",
                    "live": false,
                    "fetched_at": c.fetched_at,
                }))),
                None => Err(crate::error::AppError::Oracle("Rate unavailable".into())),
            }
        }
    }
}
