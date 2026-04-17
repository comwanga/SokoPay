//! JWT refresh endpoint.
//!
//! POST /api/auth/refresh
//!
//! Accepts a valid (non-expired) JWT and returns a new one with a fresh
//! expiry window. This allows long-lived sessions without requiring the user
//! to re-authenticate via Nostr every 24 hours.
//!
//! Security properties:
//!   • The incoming token must still be valid — we don't issue tokens for
//!     expired or tampered ones.
//!   • The new token carries the same subject, role, and farmer_id as the old
//!     one — privilege escalation is impossible through this path.
//!   • Rate-limited by the auth governor (1 req/s burst 5) declared in routes.

use crate::auth::{jwt, Claims, LoginResponse, Role};
use crate::error::AppResult;
use crate::state::SharedState;
use axum::{extract::State, Json};

/// POST /api/auth/refresh
///
/// The `Claims` extractor already validates the token (signature + expiry).
/// If valid, we simply re-sign the same identity with a new expiry.
pub async fn refresh_token(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<Json<LoginResponse>> {
    let role: Role = claims.role.clone();
    let sub = claims.sub.clone();

    let token = jwt::generate_token(
        &state.config.jwt_secret,
        &sub,
        role.clone(),
        claims.farmer_id,
        state.config.jwt_expiry_hours,
    )?;

    Ok(Json(LoginResponse {
        token,
        role: role.to_string(),
        user_id: sub,
        farmer_id: claims.farmer_id,
    }))
}
