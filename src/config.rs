use anyhow::{bail, Context, Result};

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub bitcoin_network: String,
    pub ldk_data_dir: String,
    pub esplora_url: String,
    // M-Pesa
    pub mpesa_env: String,
    pub mpesa_consumer_key: String,
    pub mpesa_consumer_secret: String,
    pub mpesa_shortcode: String,
    pub mpesa_initiator_name: String,
    pub mpesa_initiator_password: String,
    /// Path to a PEM file containing Safaricom's RSA public key (production only).
    /// Extract from the Safaricom certificate with:
    ///   openssl x509 -pubkey -noout -in ProductionCertificate.cer > mpesa_prod_pubkey.pem
    pub mpesa_cert_path: String,
    pub mpesa_result_url: String,
    pub mpesa_timeout_url: String,
    // Oracle
    pub coingecko_api_url: String,
    pub rate_cache_seconds: u64,
    // Security
    /// Shared secret for X-Api-Key header authentication.
    /// Set to a long random string in production. Empty string disables auth (dev only).
    pub api_key: String,
    /// Secret token embedded in M-Pesa callback URLs to authenticate Safaricom callbacks.
    pub webhook_secret: String,
    /// Comma-separated origins allowed by CORS (e.g. "https://app.example.com").
    pub allowed_origins: Vec<String>,
    // Observability
    /// Log output format: "json" for structured production logs, "text" for dev.
    pub log_format: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let mpesa_env = std::env::var("MPESA_ENV").unwrap_or_else(|_| "sandbox".into());

        let mpesa_consumer_key = std::env::var("MPESA_CONSUMER_KEY").unwrap_or_default();
        let mpesa_consumer_secret = std::env::var("MPESA_CONSUMER_SECRET").unwrap_or_default();
        let mpesa_initiator_password =
            std::env::var("MPESA_INITIATOR_PASSWORD").unwrap_or_default();
        let mpesa_cert_path = std::env::var("MPESA_CERT_PATH").unwrap_or_default();

        // Enforce required secrets in production to fail fast at startup.
        if mpesa_env != "sandbox" {
            if mpesa_consumer_key.is_empty() {
                bail!("MPESA_CONSUMER_KEY is required when MPESA_ENV != sandbox");
            }
            if mpesa_consumer_secret.is_empty() {
                bail!("MPESA_CONSUMER_SECRET is required when MPESA_ENV != sandbox");
            }
            if mpesa_initiator_password.is_empty() {
                bail!("MPESA_INITIATOR_PASSWORD is required when MPESA_ENV != sandbox");
            }
            if mpesa_cert_path.is_empty() {
                bail!("MPESA_CERT_PATH is required when MPESA_ENV != sandbox");
            }
        }

        let webhook_secret =
            std::env::var("WEBHOOK_SECRET").unwrap_or_else(|_| "dev-webhook-secret".into());

        let base_url = std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:3001".into());

        // Auto-build callback URLs that embed the webhook secret, unless overridden.
        let mpesa_result_url = std::env::var("MPESA_RESULT_URL").unwrap_or_else(|_| {
            format!("{}/api/webhooks/mpesa/{}/result", base_url, webhook_secret)
        });
        let mpesa_timeout_url = std::env::var("MPESA_TIMEOUT_URL").unwrap_or_else(|_| {
            format!("{}/api/webhooks/mpesa/{}/timeout", base_url, webhook_secret)
        });

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
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://agri-pay.db".into()),
            bitcoin_network: std::env::var("BITCOIN_NETWORK").unwrap_or_else(|_| "regtest".into()),
            ldk_data_dir: std::env::var("LDK_DATA_DIR").unwrap_or_else(|_| "./ldk-data".into()),
            esplora_url: std::env::var("ESPLORA_URL")
                .unwrap_or_else(|_| "https://blockstream.info/testnet/api".into()),
            mpesa_env,
            mpesa_consumer_key,
            mpesa_consumer_secret,
            mpesa_shortcode: std::env::var("MPESA_SHORTCODE").unwrap_or_else(|_| "600998".into()),
            mpesa_initiator_name: std::env::var("MPESA_INITIATOR_NAME")
                .unwrap_or_else(|_| "testapi".into()),
            mpesa_initiator_password,
            mpesa_cert_path,
            mpesa_result_url,
            mpesa_timeout_url,
            coingecko_api_url: std::env::var("COINGECKO_API_URL")
                .unwrap_or_else(|_| "https://api.coingecko.com/api/v3".into()),
            rate_cache_seconds: std::env::var("RATE_CACHE_SECONDS")
                .unwrap_or_else(|_| "60".into())
                .parse()
                .context("Invalid RATE_CACHE_SECONDS")?,
            api_key: std::env::var("API_KEY").unwrap_or_default(),
            webhook_secret,
            allowed_origins,
            log_format: std::env::var("LOG_FORMAT").unwrap_or_else(|_| "text".into()),
        })
    }

    pub fn mpesa_base_url(&self) -> &str {
        if self.mpesa_env == "sandbox" {
            "https://sandbox.safaricom.co.ke"
        } else {
            "https://api.safaricom.co.ke"
        }
    }
}
