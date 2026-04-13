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

        // APP_ENV controls how strictly we enforce security settings.
        // Accepted values: "development" (local dev only), anything else is
        // treated as a non-dev environment and gets hard failures instead of warnings.
        let app_env = std::env::var("APP_ENV").unwrap_or_else(|_| "development".into());
        let is_dev = app_env == "development";

        // ── JWT secret strength ───────────────────────────────────────────────
        // Example secrets from docs/templates are universally known — anyone can
        // forge tokens if these are in use.  We warn loudly in dev and refuse to
        // start at all in any other environment.
        // Note: tracing is not initialised yet at this point, so warnings
        // must go to stderr directly via eprintln! to be visible at startup.
        if EXAMPLE_JWT_SECRETS.contains(&jwt_secret.as_str()) {
            if is_dev {
                eprintln!(
                    "\nWARNING: JWT_SECRET is a known example value. \
                     This is only acceptable for local development. \
                     Generate a real secret with: openssl rand -base64 48\n"
                );
            } else {
                bail!(
                    "JWT_SECRET is set to a known example/default value. \
                     This is not safe for any non-development environment. \
                     Generate a secure secret with: openssl rand -base64 48"
                );
            }
        }

        // ── CORS origins ──────────────────────────────────────────────────────
        let allowed_origins: Vec<String> = std::env::var("ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:5173".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        // Wildcard CORS lets any website make credentialed API calls on behalf
        // of logged-in users (CSRF-equivalent).  Fine for a fully public API,
        // not for an authenticated payments platform.
        if allowed_origins.iter().any(|o| o == "*") && !is_dev {
            bail!(
                "CORS wildcard ('*') is not permitted outside local development. \
                 Set ALLOWED_ORIGINS to the specific frontend domain(s), \
                 e.g. https://app.agripay.example.com"
            );
        }
        if allowed_origins.iter().any(|o| o == "*") {
            eprintln!(
                "\nWARNING: CORS is set to wildcard ('*'). \
                 This is only acceptable for local development.\n"
            );
        }

        // ── Upload directory ──────────────────────────────────────────────────
        let upload_dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into());

        // Reject paths that would put uploaded files somewhere dangerous.
        // UUID filenames prevent directory traversal, but a misconfigured base
        // path could still end up writing into system directories.
        if upload_dir == "/" || upload_dir == "." || upload_dir.is_empty() {
            bail!(
                "UPLOAD_DIR '{}' is not a safe value. \
                 Use a dedicated subdirectory such as './uploads'.",
                upload_dir
            );
        }

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
            upload_dir,
            public_base_url: std::env::var("PUBLIC_BASE_URL")
                .unwrap_or_else(|_| "http://localhost:3001".into()),
            allowed_origins,
            log_format: std::env::var("LOG_FORMAT").unwrap_or_else(|_| "text".into()),
            btcpay_url: std::env::var("BTCPAY_URL").ok().filter(|s| !s.is_empty()),
            btcpay_api_key: std::env::var("BTCPAY_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            btcpay_store_id: std::env::var("BTCPAY_STORE_ID")
                .ok()
                .filter(|s| !s.is_empty()),
            btcpay_webhook_secret: std::env::var("BTCPAY_WEBHOOK_SECRET")
                .ok()
                .filter(|s| !s.is_empty()),
            nostr_relay_url: std::env::var("NOSTR_RELAY_URL")
                .ok()
                .filter(|s| !s.is_empty()),
            nostr_privkey_hex: std::env::var("NOSTR_PRIVKEY_HEX")
                .ok()
                .filter(|s| !s.is_empty()),
        })
    }
}
