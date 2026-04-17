//! Referral programme.
//!
//! Every farmer can get a unique 8-character referral code.  New farmers who
//! register with `?ref=CODE` are linked to the referrer.  No monetary rewards
//! are distributed here — the table is the source of truth for attribution;
//! reward logic lives in a separate (future) billing module.
//!
//! Endpoints:
//!   GET  /api/referrals/my-code    — get (or generate) your referral code
//!   GET  /api/referrals/stats      — how many you've referred + their join dates
//!   POST /api/referrals/apply      — record a referral for the current user

use crate::auth::jwt::Claims;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ReferralCodeResponse {
    pub referral_code: String,
    /// Full shareable link (uses PUBLIC_BASE_URL from config).
    pub share_url: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReferralEntry {
    pub referred_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ReferralStats {
    pub referral_code: String,
    pub share_url: String,
    pub total_referrals: i64,
    pub recent: Vec<ReferralEntry>,
}

#[derive(Debug, Deserialize)]
pub struct ApplyReferralRequest {
    /// Referral code supplied by the new user at signup or first login.
    pub code: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Generate a random 8-character uppercase alphanumeric code.
fn random_code() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
    let mut rng = rand::rngs::OsRng;
    (0..8)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

/// Fetch existing code or insert a freshly generated one (retries on collision).
async fn ensure_referral_code(pool: &sqlx::PgPool, farmer_id: Uuid) -> AppResult<String> {
    // Fast path: code already set.
    if let Some(code) =
        sqlx::query_scalar::<_, Option<String>>("SELECT referral_code FROM farmers WHERE id = $1")
            .bind(farmer_id)
            .fetch_optional(pool)
            .await?
            .flatten()
    {
        return Ok(code);
    }

    // Slow path: generate + store, retrying up to 5 times on collision.
    for _ in 0..5 {
        let code = random_code();
        let updated = sqlx::query(
            "UPDATE farmers
             SET referral_code = $1
             WHERE id = $2 AND referral_code IS NULL",
        )
        .bind(&code)
        .bind(farmer_id)
        .execute(pool)
        .await?
        .rows_affected();

        if updated > 0 {
            return Ok(code);
        }

        // Race: another request just set it — fetch whatever won.
        if let Some(code) = sqlx::query_scalar::<_, Option<String>>(
            "SELECT referral_code FROM farmers WHERE id = $1",
        )
        .bind(farmer_id)
        .fetch_optional(pool)
        .await?
        .flatten()
        {
            return Ok(code);
        }
    }

    Err(AppError::Internal(anyhow::anyhow!(
        "Could not generate a unique referral code after 5 attempts"
    )))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// GET /api/referrals/my-code
///
/// Returns the farmer's referral code, generating one on first call.
pub async fn get_my_referral_code(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<Json<ReferralCodeResponse>> {
    let farmer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Farmer account required".into()))?;

    let code = ensure_referral_code(&state.db, farmer_id).await?;
    let share_url = format!(
        "{}/?ref={}",
        state.config.public_base_url.trim_end_matches('/'),
        code
    );

    Ok(Json(ReferralCodeResponse {
        referral_code: code,
        share_url,
    }))
}

/// GET /api/referrals/stats
///
/// Returns referral code + stats (total count, recent 20 referrals).
pub async fn get_referral_stats(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<Json<ReferralStats>> {
    let farmer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Farmer account required".into()))?;

    let code = ensure_referral_code(&state.db, farmer_id).await?;
    let share_url = format!(
        "{}/?ref={}",
        state.config.public_base_url.trim_end_matches('/'),
        code
    );

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM referrals WHERE referrer_id = $1")
        .bind(farmer_id)
        .fetch_one(&state.db)
        .await?;

    let recent: Vec<ReferralEntry> = sqlx::query_as(
        "SELECT f.name AS referred_name, r.created_at
         FROM referrals r
         JOIN farmers f ON f.id = r.referred_id
         WHERE r.referrer_id = $1
         ORDER BY r.created_at DESC
         LIMIT 20",
    )
    .bind(farmer_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(ReferralStats {
        referral_code: code,
        share_url,
        total_referrals: total,
        recent,
    }))
}

/// POST /api/referrals/apply
///
/// Records that the currently authenticated farmer was referred by `code`.
/// Idempotent — a second call for the same farmer is silently ignored.
/// Must be called on first login / signup, not retroactively.
pub async fn apply_referral(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<ApplyReferralRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let referred_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Farmer account required".into()))?;

    let code = body.code.trim().to_uppercase();
    if code.is_empty() {
        return Err(AppError::BadRequest("referral code is required".into()));
    }

    // Find referrer — must be a different, active farmer.
    let referrer_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM farmers
         WHERE referral_code = $1 AND id <> $2 AND deleted_at IS NULL",
    )
    .bind(&code)
    .bind(referred_id)
    .fetch_optional(&state.db)
    .await?;

    let referrer_id =
        referrer_id.ok_or_else(|| AppError::NotFound("Referral code not found".into()))?;

    // ON CONFLICT DO NOTHING makes this idempotent.
    sqlx::query(
        "INSERT INTO referrals (referrer_id, referred_id)
         VALUES ($1, $2)
         ON CONFLICT (referred_id) DO NOTHING",
    )
    .bind(referrer_id)
    .bind(referred_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "applied": true })))
}
