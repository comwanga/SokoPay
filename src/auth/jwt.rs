use crate::error::AppError;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;


#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Admin,
    Operator,
    Farmer,
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Role::Admin => write!(f, "admin"),
            Role::Operator => write!(f, "operator"),
            Role::Farmer => write!(f, "farmer"),
        }
    }
}

impl std::str::FromStr for Role {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "admin" => Ok(Role::Admin),
            "operator" => Ok(Role::Operator),
            "farmer" => Ok(Role::Farmer),
            _ => Err(AppError::BadRequest(format!("Unknown role: {}", s))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject: user UUID (or "admin" for the built-in admin account)
    pub sub: String,
    pub role: Role,
    /// Farmer UUID — set only when role == Farmer
    pub farmer_id: Option<Uuid>,
    /// Expiry (Unix timestamp)
    pub exp: usize,
    /// Issued at (Unix timestamp)
    pub iat: usize,
    /// Unique token ID — used to revoke a specific token without invalidating all tokens.
    /// Tokens issued before this field was added will not have it (jti = None).
    /// The revocation check is skipped for None to allow graceful rollout.
    #[serde(default)]
    pub jti: Option<Uuid>,
}

pub fn generate_token(
    secret: &str,
    sub: &str,
    role: Role,
    farmer_id: Option<Uuid>,
    expiry_hours: u64,
) -> Result<String, AppError> {
    let now = Utc::now();
    let exp = (now + Duration::hours(expiry_hours as i64)).timestamp() as usize;
    let iat = now.timestamp() as usize;

    let claims = Claims {
        sub: sub.to_string(),
        role,
        farmer_id,
        exp,
        iat,
        jti: Some(Uuid::new_v4()),
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;
    Ok(token)
}

pub fn validate_token(secret: &str, token: &str) -> Result<Claims, AppError> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(token_data.claims)
}
