use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::Response,
    Json,
};
use serde_json::json;
use crate::state::SharedState;

/// Require an `X-Api-Key` header that matches `config.api_key`.
///
/// If `config.api_key` is empty the check is bypassed (development / sandbox mode).
/// In production, set `API_KEY` to a long random secret and require it on all API clients.
pub async fn require_api_key(
    State(state): State<SharedState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    // Bypass when no key configured (dev / sandbox).
    if state.config.api_key.is_empty() {
        return Ok(next.run(req).await);
    }

    let provided = req
        .headers()
        .get("X-Api-Key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if provided != state.config.api_key {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Unauthorized: invalid or missing X-Api-Key header" })),
        ));
    }

    Ok(next.run(req).await)
}
