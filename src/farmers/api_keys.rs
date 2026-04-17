//! Developer API key management.
//!
//! Endpoints:
//!   POST   /api/api-keys          — create a new key (returns raw key ONCE)
//!   GET    /api/api-keys          — list active keys (metadata only, no raw key)
//!   DELETE /api/api-keys/:id      — revoke a key

use crate::auth::api_key::hash_key;
use crate::auth::jwt::Claims;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Request / response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateKeyRequest {
    /// Human-readable label so the farmer remembers what this key is for.
    pub name: String,
    /// Optional scope list.  Defaults to `["read:products","read:orders"]`.
    pub scopes: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct CreatedKeyResponse {
    pub id: Uuid,
    pub name: String,
    pub key_prefix: String,
    /// The full raw key — shown ONCE, never retrievable again.
    pub raw_key: String,
    pub scopes: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ApiKeyRow {
    pub id: Uuid,
    pub name: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ALLOWED_SCOPES: &[&str] = &[
    "read:products",
    "write:products",
    "read:orders",
    "write:orders",
    "read:payments",
];

fn validate_scopes(scopes: &[String]) -> Result<(), AppError> {
    for s in scopes {
        if !ALLOWED_SCOPES.contains(&s.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Unknown scope '{}'. Allowed: {}",
                s,
                ALLOWED_SCOPES.join(", ")
            )));
        }
    }
    Ok(())
}

/// Generate a cryptographically random API key.
/// Format: `skp_` + 32 random bytes as lowercase hex (64 chars) = 68 chars total.
fn generate_raw_key() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!("skp_{}", hex::encode(bytes))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/api-keys
///
/// Creates a new API key.  The raw key is returned ONCE in the response;
/// only its SHA-256 hash is stored in the database.
pub async fn create_api_key(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<CreateKeyRequest>,
) -> AppResult<(StatusCode, Json<CreatedKeyResponse>)> {
    let farmer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Farmer account required".into()))?;

    let name = body.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest(
            "Key name must be 1–100 characters".into(),
        ));
    }

    let scopes = body.scopes.unwrap_or_else(|| {
        vec!["read:products".into(), "read:orders".into()]
    });
    validate_scopes(&scopes)?;

    let raw = generate_raw_key();
    let hash = hash_key(&raw);
    let prefix = raw[..12].to_string(); // "skp_" + first 8 hex chars

    let row: ApiKeyRow = sqlx::query_as(
        "INSERT INTO api_keys (farmer_id, name, key_hash, key_prefix, scopes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, key_prefix, scopes, last_used_at, created_at",
    )
    .bind(farmer_id)
    .bind(&name)
    .bind(&hash)
    .bind(&prefix)
    .bind(&scopes[..])
    .fetch_one(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreatedKeyResponse {
            id: row.id,
            name: row.name,
            key_prefix: row.key_prefix,
            raw_key: raw,
            scopes: row.scopes,
            created_at: row.created_at,
        }),
    ))
}

/// GET /api/api-keys
///
/// List all active (non-revoked) API keys for the authenticated farmer.
pub async fn list_api_keys(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<Json<Vec<ApiKeyRow>>> {
    let farmer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Farmer account required".into()))?;

    let rows: Vec<ApiKeyRow> = sqlx::query_as(
        "SELECT id, name, key_prefix, scopes, last_used_at, created_at
         FROM api_keys
         WHERE farmer_id = $1 AND revoked_at IS NULL
         ORDER BY created_at DESC",
    )
    .bind(farmer_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// DELETE /api/api-keys/:id
///
/// Revoke a key.  The farmer can only revoke their own keys.
pub async fn revoke_api_key(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let farmer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Farmer account required".into()))?;

    let rows_affected = sqlx::query(
        "UPDATE api_keys
         SET revoked_at = NOW()
         WHERE id = $1 AND farmer_id = $2 AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(farmer_id)
    .execute(&state.db)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(AppError::NotFound("API key not found".into()));
    }

    Ok(Json(serde_json::json!({ "revoked": true, "id": id })))
}
