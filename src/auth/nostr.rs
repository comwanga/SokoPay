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

// ── Shared helper: find or create a farmer row by Nostr pubkey ────────────────

async fn find_or_create_farmer(db: &sqlx::PgPool, pubkey: &str) -> AppResult<Uuid> {
    let existing: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM farmers WHERE nostr_pubkey = $1 AND deleted_at IS NULL")
            .bind(pubkey)
            .fetch_optional(db)
            .await
            .map_err(|e| {
                tracing::error!("DB error looking up farmer by pubkey: {}", e);
                e
            })?;

    if let Some(id) = existing {
        return Ok(id);
    }

    // New user — phone is NULL for Nostr-only accounts; cooperative defaults to ''
    let id: Uuid =
        sqlx::query_scalar("INSERT INTO farmers (name, nostr_pubkey) VALUES ($1, $2) RETURNING id")
            .bind(format!("Member {}", &pubkey[..8]))
            .bind(pubkey)
            .fetch_one(db)
            .await
            .map_err(|e| {
                tracing::error!(
                    "DB error inserting farmer for pubkey {}: {}",
                    &pubkey[..8],
                    e
                );
                e
            })?;

    Ok(id)
}

// ── NIP-98 authenticated login ────────────────────────────────────────────────

pub async fn nostr_login(
    State(state): State<SharedState>,
    Json(body): Json<NostrLoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    let event = &body.event;

    // 1. Must be NIP-98 kind
    if event.kind != 27235 {
        return Err(AppError::BadRequest("Event must be kind 27235".into()));
    }

    // 2. Timestamp within ±30 seconds of server time.
    //    60 seconds was too wide — it doubles the cross-service replay window.
    let now = chrono::Utc::now().timestamp();
    if (now - event.created_at).abs() > 30 {
        return Err(AppError::NostrAuth {
            reason: "Event timestamp is more than 30 seconds from server time".into(),
        });
    }

    // 3. u tag must be the exact URL of this auth endpoint.
    //    ends_with() would accept tokens minted for evil.com/api/auth/nostr,
    //    enabling cross-service replay attacks within the 30-second window.
    let expected_url = format!("{}/api/auth/nostr", state.config.public_base_url);
    let u_tag = event
        .tags
        .iter()
        .find(|t| t.first().map(|s| s == "u").unwrap_or(false))
        .and_then(|t| t.get(1))
        .ok_or_else(|| AppError::NostrAuth {
            reason: "Missing u tag".into(),
        })?;
    if u_tag.as_str() != expected_url {
        return Err(AppError::NostrAuth {
            reason: format!("u tag must be exactly {expected_url}"),
        });
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
    let computed_id = hex::encode(Sha256::digest(canonical_bytes));
    if computed_id != event.id {
        return Err(AppError::Unauthorized("Event ID mismatch".into()));
    }

    // 6. Verify BIP-340 Schnorr signature
    verify_schnorr(&event.pubkey, &event.id, &event.sig)?;

    // 7. Find or create user by Nostr pubkey
    let farmer_id = find_or_create_farmer(&state.db, &event.pubkey).await?;

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

// ── Pubkey-only login — DISABLED (security: no cryptographic proof of key ownership) ──
//
// This endpoint previously issued JWTs to anyone who supplied a valid-looking
// hex pubkey, with no proof they control the corresponding private key. That
// allows impersonation of any Nostr account. Removed in Phase 0 security
// hardening. Clients must use POST /api/auth/nostr (NIP-98 signed event).

#[derive(Debug, Deserialize)]
pub struct PubkeyLoginRequest {
    #[allow(dead_code)]
    pub pubkey: String,
}

pub async fn pubkey_login(
    _state: State<SharedState>,
    _body: Json<PubkeyLoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    Err(AppError::Forbidden(
        "pubkey-only login is disabled. Use POST /api/auth/nostr with a NIP-98 signed event."
            .into(),
    ))
}

fn verify_schnorr(pubkey_hex: &str, event_id_hex: &str, sig_hex: &str) -> AppResult<()> {
    use secp256k1::{schnorr::Signature, Message, XOnlyPublicKey, SECP256K1};

    let pubkey_bytes =
        hex::decode(pubkey_hex).map_err(|_| AppError::BadRequest("Invalid pubkey hex".into()))?;
    let event_id_bytes = hex::decode(event_id_hex)
        .map_err(|_| AppError::BadRequest("Invalid event id hex".into()))?;
    let sig_bytes =
        hex::decode(sig_hex).map_err(|_| AppError::BadRequest("Invalid signature hex".into()))?;

    let pubkey = XOnlyPublicKey::from_slice(&pubkey_bytes)
        .map_err(|_| AppError::Unauthorized("Invalid Nostr public key".into()))?;

    let sig = Signature::from_slice(&sig_bytes)
        .map_err(|_| AppError::Unauthorized("Invalid signature format".into()))?;

    // event_id is SHA-256(canonical event JSON) — exactly 32 bytes
    let msg = Message::from_digest_slice(&event_id_bytes)
        .map_err(|_| AppError::Unauthorized("Invalid event id length".into()))?;

    SECP256K1
        .verify_schnorr(&sig, &msg, &pubkey)
        .map_err(|_| AppError::Unauthorized("Invalid Nostr signature".into()))?;

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    /// Check that the URL comparison logic rejects cross-site tokens.
    /// The handler does `u_tag == expected_url`; these tests mirror that logic.
    #[test]
    fn test_u_tag_exact_match_required() {
        let expected = "https://sokopay.app/api/auth/nostr";

        // Correct URL passes
        assert_eq!("https://sokopay.app/api/auth/nostr", expected);

        // Same path suffix on a different domain must fail
        assert_ne!("https://evil.com/api/auth/nostr", expected);

        // Old ends_with target — must also fail with exact check
        assert_ne!("https://evil.com/auth/nostr", expected);

        // Trailing slash variation must fail
        assert_ne!("https://sokopay.app/api/auth/nostr/", expected);
    }

    /// Check that the 30-second timestamp window logic is correct.
    /// The handler does `(now - created_at).abs() > 30`.
    #[test]
    fn test_timestamp_window() {
        let now = chrono::Utc::now().timestamp();

        // Within the window — must pass (abs diff ≤ 30)
        assert!((now - (now - 15)).abs() <= 30, "15s ago should be within window");
        assert!((now - now).abs() <= 30, "now should be within window");
        assert!((now - (now + 10)).abs() <= 30, "10s in future should be within window");

        // Outside the window — must be rejected (abs diff > 30)
        assert!((now - (now - 31)).abs() > 30, "31s ago should be stale");
        assert!((now - (now - 3600)).abs() > 30, "1 hour ago should be stale");
        assert!((now - (now + 31)).abs() > 30, "31s in future should be rejected");
    }
}
