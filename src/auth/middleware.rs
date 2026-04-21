use super::jwt::{validate_token, Claims};
use crate::error::AppError;
use crate::state::SharedState;
use anyhow::anyhow;
use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, HeaderMap},
};
use std::convert::Infallible;

/// Axum extractor that reads the `Authorization: Bearer <token>` header,
/// validates the JWT, and injects `Claims` into the request extensions.
#[async_trait]
impl FromRequestParts<SharedState> for Claims {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &SharedState,
    ) -> Result<Self, Self::Rejection> {
        let token = extract_bearer(&parts.headers).ok_or_else(|| {
            AppError::Unauthorized("Missing or malformed Authorization header".into())
        })?;

        let claims = validate_token(&state.config.jwt_secret, token)?;

        // If the token has a jti, check whether it has been explicitly revoked.
        // Tokens issued before the jti field was added have jti = None;
        // we skip the check for those to allow a graceful rollout.
        if let Some(jti) = claims.jti {
            let revoked: Option<bool> = sqlx::query_scalar(
                "SELECT true FROM jwt_revocations WHERE jti = $1",
            )
            .bind(jti)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!("JWT revocation DB check failed: {}", e);
                AppError::Internal(anyhow!("Token validation failed"))
            })?;

            if revoked.is_some() {
                return Err(AppError::Unauthorized("Token has been revoked".into()));
            }
        }

        Ok(claims)
    }
}

/// Optional claims extractor — succeeds with `None` when no valid token is present.
/// Use for endpoints that work both authenticated and unauthenticated.
#[allow(dead_code)]
pub struct OptionalClaims(pub Option<Claims>);

#[async_trait]
impl FromRequestParts<SharedState> for OptionalClaims {
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &SharedState,
    ) -> Result<Self, Infallible> {
        match Claims::from_request_parts(parts, state).await {
            Ok(claims) => Ok(OptionalClaims(Some(claims))),
            Err(_) => Ok(OptionalClaims(None)),
        }
    }
}

fn extract_bearer(headers: &HeaderMap) -> Option<&str> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    value.strip_prefix("Bearer ")
}
