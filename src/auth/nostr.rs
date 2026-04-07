use crate::auth::jwt;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{LoginResponse, Role};

#[derive(Debug, Deserialize)]
pub struct NostrLoginRequest {
    pub event: NostrEvent,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NostrEvent {
    pub id: String,
    pub pubkey: String,
    pub created_at: i64,
    pub kind: u64,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

pub async fn nostr_login(
    State(state): State<SharedState>,
    Json(body): Json<NostrLoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    let event = &body.event;

    // 1. Must be NIP-98 kind
    if event.kind != 27235 {
        return Err(AppError::BadRequest("Event must be kind 27235".into()));
    }

    // 2. Timestamp within 60 seconds
    let now = chrono::Utc::now().timestamp();
    if (now - event.created_at).abs() > 60 {
        return Err(AppError::Unauthorized(
            "Event timestamp out of range".into(),
        ));
    }

    // 3. u tag must reference this endpoint
    let u_tag = event
        .tags
        .iter()
        .find(|t| t.first().map(|s| s == "u").unwrap_or(false))
        .and_then(|t| t.get(1))
        .ok_or_else(|| AppError::BadRequest("Missing u tag".into()))?;
    if !u_tag.contains("/api/auth/nostr") {
        return Err(AppError::BadRequest("Invalid u tag".into()));
    }

    // 4. method tag must be POST
    let method_tag = event
        .tags
        .iter()
        .find(|t| t.first().map(|s| s == "method").unwrap_or(false))
        .and_then(|t| t.get(1))
        .ok_or_else(|| AppError::BadRequest("Missing method tag".into()))?;
    if method_tag.to_uppercase() != "POST" {
        return Err(AppError::BadRequest("Invalid method tag".into()));
    }

    // 5. Verify event ID = SHA256(canonical JSON)
    let canonical = serde_json::json!([
        0,
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content,
    ]);
    let canonical_bytes = serde_json::to_vec(&canonical)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("serialize error: {}", e)))?;
    let computed_id = hex::encode(Sha256::digest(&canonical_bytes));
    if computed_id != event.id {
        return Err(AppError::Unauthorized("Event ID mismatch".into()));
    }

    // 6. Verify BIP-340 Schnorr signature
    verify_schnorr(&event.pubkey, &event.id, &event.sig)?;

    // 7. Find or create user by Nostr pubkey
    let pubkey = &event.pubkey;

    let existing: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM farmers WHERE nostr_pubkey = $1")
            .bind(pubkey)
            .fetch_optional(&state.db)
            .await?;

    let farmer_id = match existing {
        Some(id) => id,
        None => {
            // New user: create a farmers row. Phone is NULL for Nostr-only accounts.
            sqlx::query_scalar(
                "INSERT INTO farmers (name, nostr_pubkey)
                 VALUES ($1, $2)
                 RETURNING id",
            )
            .bind(format!("Member {}", &pubkey[..8]))
            .bind(pubkey)
            .fetch_one(&state.db)
            .await?
        }
    };

    let sub = farmer_id.to_string();
    let token = jwt::generate_token(
        &state.config.jwt_secret,
        &sub,
        Role::Farmer,
        Some(farmer_id),
        state.config.jwt_expiry_hours,
    )?;

    Ok(Json(LoginResponse {
        token,
        role: "farmer".into(),
        user_id: sub,
        farmer_id: Some(farmer_id),
    }))
}

// ── Pubkey-only login (no signature — for users who know their npub) ─────────

#[derive(Debug, Deserialize)]
pub struct PubkeyLoginRequest {
    /// 64-character lowercase hex Nostr public key (frontend decodes npub first)
    pub pubkey: String,
}

pub async fn pubkey_login(
    State(state): State<SharedState>,
    Json(body): Json<PubkeyLoginRequest>,
) -> AppResult<Json<super::LoginResponse>> {
    let pubkey = body.pubkey.trim().to_lowercase();

    if pubkey.len() != 64 || !pubkey.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "pubkey must be a 64-character hex string".into(),
        ));
    }

    let farmer_id: uuid::Uuid =
        match sqlx::query_scalar("SELECT id FROM farmers WHERE nostr_pubkey = $1")
            .bind(&pubkey)
            .fetch_optional(&state.db)
            .await?
        {
            Some(id) => id,
            None => {
                sqlx::query_scalar(
                    "INSERT INTO farmers (name, nostr_pubkey)
                 VALUES ($1, $2)
                 RETURNING id",
                )
                .bind(format!("Member {}", &pubkey[..8]))
                .bind(&pubkey)
                .fetch_one(&state.db)
                .await?
            }
        };

    let sub = farmer_id.to_string();
    let token = super::jwt::generate_token(
        &state.config.jwt_secret,
        &sub,
        super::Role::Farmer,
        Some(farmer_id),
        state.config.jwt_expiry_hours,
    )?;

    Ok(axum::Json(super::LoginResponse {
        token,
        role: "farmer".into(),
        user_id: sub,
        farmer_id: Some(farmer_id),
    }))
}

fn verify_schnorr(pubkey_hex: &str, event_id_hex: &str, sig_hex: &str) -> AppResult<()> {
    use k256::schnorr::{Signature, VerifyingKey};
    use signature::Verifier;

    let pubkey_bytes =
        hex::decode(pubkey_hex).map_err(|_| AppError::BadRequest("Invalid pubkey hex".into()))?;
    let event_id_bytes = hex::decode(event_id_hex)
        .map_err(|_| AppError::BadRequest("Invalid event id hex".into()))?;
    let sig_bytes =
        hex::decode(sig_hex).map_err(|_| AppError::BadRequest("Invalid signature hex".into()))?;

    let vk = VerifyingKey::from_bytes(&pubkey_bytes)
        .map_err(|_| AppError::Unauthorized("Invalid Nostr public key".into()))?;
    let sig = Signature::try_from(sig_bytes.as_slice())
        .map_err(|_| AppError::Unauthorized("Invalid signature format".into()))?;

    vk.verify(&event_id_bytes, &sig)
        .map_err(|_| AppError::Unauthorized("Invalid Nostr signature".into()))?;

    Ok(())
}
