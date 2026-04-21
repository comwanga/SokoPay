pub mod api_key;
pub mod jwt;
pub mod middleware;
pub mod nostr;
pub mod refresh;

pub use nostr::{nostr_login, pubkey_login};
pub use refresh::refresh_token;

use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use axum::{extract::State, Json};
use chrono::{TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

pub use jwt::{Claims, Role};

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub role: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub farmer_id: Option<Uuid>,
}

#[derive(FromRow)]
struct UserRow {
    id: Uuid,
    password_hash: String,
    role: String,
    farmer_id: Option<Uuid>,
}

#[derive(FromRow)]
struct FarmerAuthRow {
    id: Uuid,
    pin_hash: Option<String>,
}

pub async fn login(
    State(state): State<SharedState>,
    Json(body): Json<LoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    // 1. Built-in admin account
    if body.username == "admin" {
        let hash = &state.config.admin_password_hash;
        if !hash.is_empty() {
            let valid = bcrypt::verify(&body.password, hash)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt error: {}", e)))?;
            if valid {
                let token = jwt::generate_token(
                    &state.config.jwt_secret,
                    "admin",
                    Role::Admin,
                    None,
                    state.config.jwt_expiry_hours,
                )?;
                return Ok(Json(LoginResponse {
                    token,
                    role: "admin".into(),
                    user_id: "admin".into(),
                    farmer_id: None,
                }));
            }
        }
        return Err(AppError::Unauthorized("Invalid credentials".into()));
    }

    // 2. Users table (operator / admin accounts)
    let user: Option<UserRow> =
        sqlx::query_as("SELECT id, password_hash, role, farmer_id FROM users WHERE username = $1")
            .bind(&body.username)
            .fetch_optional(&state.db)
            .await?;

    if let Some(user) = user {
        let valid = bcrypt::verify(&body.password, &user.password_hash)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt error: {}", e)))?;
        if !valid {
            return Err(AppError::Unauthorized("Invalid credentials".into()));
        }
        let role: Role = user.role.parse()?;
        let sub = user.id.to_string();
        let token = jwt::generate_token(
            &state.config.jwt_secret,
            &sub,
            role.clone(),
            user.farmer_id,
            state.config.jwt_expiry_hours,
        )?;
        return Ok(Json(LoginResponse {
            token,
            role: role.to_string(),
            user_id: sub,
            farmer_id: user.farmer_id,
        }));
    }

    // 3. Farmer phone + PIN login (phone may be NULL for Nostr-only accounts)
    let farmer: Option<FarmerAuthRow> =
        sqlx::query_as("SELECT id, pin_hash FROM farmers WHERE phone = $1 AND deleted_at IS NULL")
            .bind(&body.username)
            .fetch_optional(&state.db)
            .await?;

    if let Some(farmer) = farmer {
        let hash = farmer.pin_hash.as_deref().unwrap_or("");
        if hash.is_empty() {
            return Err(AppError::Unauthorized("Farmer has no PIN set".into()));
        }
        let valid = bcrypt::verify(&body.password, hash)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt error: {}", e)))?;
        if !valid {
            return Err(AppError::Unauthorized("Invalid credentials".into()));
        }
        let farmer_id = farmer.id;
        let sub = farmer_id.to_string();
        let token = jwt::generate_token(
            &state.config.jwt_secret,
            &sub,
            Role::Farmer,
            Some(farmer_id),
            state.config.jwt_expiry_hours,
        )?;
        return Ok(Json(LoginResponse {
            token,
            role: "farmer".into(),
            user_id: sub,
            farmer_id: Some(farmer_id),
        }));
    }

    Err(AppError::Unauthorized("Invalid credentials".into()))
}

/// POST /api/auth/logout
///
/// Revokes the caller's current token so it cannot be used again even if it
/// has not expired yet.  A new token must be obtained via /auth/nostr or /auth/login.
///
/// Also cleans up any expired revocation rows to keep the table small.
pub async fn logout(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<axum::http::StatusCode> {
    let jti = match claims.jti {
        Some(j) => j,
        None => {
            // Token was issued before jti was added — nothing to revoke.
            return Ok(axum::http::StatusCode::NO_CONTENT);
        }
    };

    // Store the token's expiry so the cleanup query knows when to drop the row.
    let expires_at = Utc
        .timestamp_opt(claims.exp as i64, 0)
        .single()
        .unwrap_or_else(Utc::now);

    sqlx::query(
        "INSERT INTO jwt_revocations (jti, expires_at) VALUES ($1, $2)
         ON CONFLICT (jti) DO NOTHING",
    )
    .bind(jti)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    // Remove rows whose tokens have already expired — they can never be used
    // anyway, so there is no value in keeping them.
    let _ = sqlx::query("DELETE FROM jwt_revocations WHERE expires_at < NOW()")
        .execute(&state.db)
        .await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct RegisterUserRequest {
    pub username: String,
    pub password: String,
    pub role: String,
    pub farmer_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct RegisterUserResponse {
    pub id: Uuid,
    pub username: String,
    pub role: String,
}

pub async fn register(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<RegisterUserRequest>,
) -> AppResult<Json<RegisterUserResponse>> {
    if claims.role != Role::Admin {
        return Err(AppError::Forbidden("Admin only".into()));
    }

    let role: Role = body.role.parse()?;

    let hash = bcrypt::hash(&body.password, bcrypt::DEFAULT_COST)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt hash error: {}", e)))?;

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (username, password_hash, role, farmer_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(&body.username)
    .bind(&hash)
    .bind(role.to_string())
    .bind(body.farmer_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(RegisterUserResponse {
        id,
        username: body.username,
        role: role.to_string(),
    }))
}
