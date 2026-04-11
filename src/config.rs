use anyhow::{bail, Context, Result};

/// Known example/placeholder JWT secrets from documentation and .env.example.
/// If JWT_SECRET matches any of these in production, startup fails.
const EXAMPLE_JWT_SECRETS: &[&str] = &[
    "dev-jwt-secret-replace-in-production-32x",
    "dev-jwt-secret-change-in-production!!",
    "your-jwt-secret-min-32-chars",
    "change-this-in-production-min-32-chars",
];

#[derive(Clone, Debug)]
pub struct Config {
    // Server
    pub host: String,
    pub port: u16,
    // Database
    pub database_url: String,
    // JWT
    pub jwt_secret: String,
    pub jwt_expiry_hours: u64,
    // Admin
    pub admin_password_hash: String,
    // Oracle
    pub coingecko_api_url: String,
    pub rate_cache_seconds: u64,
    pub max_rate_stale_secs: u64,
    // Storage (image uploads)
    pub upload_dir: String,
    pub public_base_url: String,
    // Security / CORS
    pub allowed_origins: Vec<String>,
    // Observability
    pub log_format: String,
    // BTCPay Server (optional — enables platform-hosted Lightning Addresses)
    pub btcpay_url: Option<String>,
    pub btcpay_api_key: Option<String>,
    pub btcpay_store_id: Option<String>,
    pub btcpay_webhook_secret: Option<String>,
    // Nostr relay (optional — enables order-status DM notifications)
    pub nostr_relay_url: Option<String>,
    pub nostr_privkey_hex: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "dev-jwt-secret-change-in-production!!".into());

        if jwt_secret.len() < 32 {
            bail!("JWT_SECRET must be at least 32 characters");
        }

        let app_env = std::env::var("APP_ENV").unwrap_or_else(|_| "development".into());
        if app_env == "production" && EXAMPLE_JWT_SECRETS.contains(&jwt_secret.as_str()) {
            bail!(
                "JWT_SECRET is set to a known example value. \
                 Generate a secure secret with: openssl rand -base64 48"
            );
        } else if EXAMPLE_JWT_SECRETS.contains(&jwt_secret.as_str()) {
            eprintln!(
                "\n⚠️  WARNING: JWT_SECRET is an example value. \
                 Do not deploy this to production.\n"
            );
        }

        let allowed_origins: Vec<String> = std::env::var("ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:5173".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok(Self {
            host: std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "3001".into())
                .parse()
                .context("Invalid PORT")?,
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            jwt_secret,
            jwt_expiry_hours: std::env::var("JWT_EXPIRY_HOURS")
                .unwrap_or_else(|_| "24".into())
                .parse()
                .context("Invalid JWT_EXPIRY_HOURS")?,
            admin_password_hash: std::env::var("ADMIN_PASSWORD_HASH").unwrap_or_default(),
            coingecko_api_url: std::env::var("COINGECKO_API_URL")
                .unwrap_or_else(|_| "https://api.coingecko.com/api/v3".into()),
            rate_cache_seconds: std::env::var("RATE_CACHE_SECONDS")
                .unwrap_or_else(|_| "60".into())
                .parse()
                .context("Invalid RATE_CACHE_SECONDS")?,
            max_rate_stale_secs: std::env::var("MAX_RATE_STALE_SECS")
                .unwrap_or_else(|_| "3600".into())
                .parse()
                .context("Invalid MAX_RATE_STALE_SECS")?,
            upload_dir: std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into()),
            public_base_url: std::env::var("PUBLIC_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:3001".into()),
            allowed_origins,
            log_format: std::env::var("LOG_FORMAT").unwrap_or_else(|_| "text".into()),
            btcpay_url: std::env::var("BTCPAY_URL").ok().filter(|s| !s.is_empty()),
            btcpay_api_key: std::env::var("BTCPAY_API_KEY").ok().filter(|s| !s.is_empty()),
            btcpay_store_id: std::env::var("BTCPAY_STORE_ID").ok().filter(|s| !s.is_empty()),
            btcpay_webhook_secret: std::env::var("BTCPAY_WEBHOOK_SECRET")
                .ok()
                .filter(|s| !s.is_empty()),
            nostr_relay_url: std::env::var("NOSTR_RELAY_URL").ok().filter(|s| !s.is_empty()),
            nostr_privkey_hex: std::env::var("NOSTR_PRIVKEY_HEX")
                .ok()
                .filter(|s| !s.is_empty()),
        })
    }
}
