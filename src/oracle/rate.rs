use crate::config::Config;
use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;

/// ISO-4217 currency codes fetched from CoinGecko in a single API call.
/// Ordered: KES first (primary market), then major globals, then East/South African.
pub const SUPPORTED_CURRENCIES: &[&str] = &[
    "kes", // Kenyan Shilling       — East Africa
    "usd", // US Dollar             — global benchmark
    "eur", // Euro
    "gbp", // British Pound
    "ngn", // Nigerian Naira        — West Africa
    "ugx", // Ugandan Shilling      — East Africa
    "tzs", // Tanzanian Shilling    — East Africa
    "rwf", // Rwandan Franc         — East Africa
    "etb", // Ethiopian Birr        — East Africa
    "zar", // South African Rand    — Southern Africa
];

/// All rates returned in one CoinGecko fetch.
#[derive(Debug, Clone)]
pub struct AllRates {
    pub rates: HashMap<String, f64>, // currency_code (uppercase) → BTC price
}

impl AllRates {
    /// BTC/KES rate (primary, always present).
    pub fn btc_kes(&self) -> f64 {
        *self.rates.get("KES").unwrap_or(&0.0)
    }

    /// BTC/USD rate.
    pub fn btc_usd(&self) -> f64 {
        *self.rates.get("USD").unwrap_or(&0.0)
    }

    /// Get rate for a given ISO-4217 code (case-insensitive).
    pub fn get(&self, currency: &str) -> Option<f64> {
        self.rates.get(&currency.to_uppercase()).copied()
    }
}

// ── CoinGecko deserialisation ─────────────────────────────────────────────────

/// CoinGecko /simple/price response — keys are lowercase currency codes.
#[derive(Deserialize)]
struct CoinGeckoResponse {
    bitcoin: HashMap<String, f64>,
}

// ── Oracle ────────────────────────────────────────────────────────────────────

pub struct RateOracle {
    http: Client,
    api_url: String,
    pub cache_ttl_secs: u64,
}

impl RateOracle {
    pub fn new(config: &Config, http: Client) -> Self {
        Self {
            http,
            api_url: config.coingecko_api_url.clone(),
            cache_ttl_secs: config.rate_cache_seconds,
        }
    }

    /// Fetch all supported currency rates in a single CoinGecko API call.
    pub async fn fetch_all_rates(&self) -> Result<AllRates> {
        let vs_currencies = SUPPORTED_CURRENCIES.join(",");
        let url = format!(
            "{}/simple/price?ids=bitcoin&vs_currencies={}",
            self.api_url, vs_currencies
        );

        let resp = self
            .http
            .get(&url)
            .header("User-Agent", "agri-pay/0.3")
            .send()
            .await?
            .json::<CoinGeckoResponse>()
            .await?;

        // Normalise keys to uppercase for consistent lookup
        let rates: HashMap<String, f64> = resp
            .bitcoin
            .into_iter()
            .map(|(k, v)| (k.to_uppercase(), v))
            .collect();

        Ok(AllRates { rates })
    }

    /// Convert KES amount to satoshis using the given BTC/KES rate.
    #[allow(dead_code)]
    pub fn kes_to_sats(amount_kes: f64, btc_kes_rate: f64) -> u64 {
        if btc_kes_rate <= 0.0 {
            return 0;
        }
        let btc_amount = amount_kes / btc_kes_rate;
        let sats = btc_amount * 100_000_000.0;
        sats.round() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::RateOracle;

    const RATE: f64 = 10_000_000.0;

    #[test]
    fn test_kes_to_sats_round_number() {
        assert_eq!(RateOracle::kes_to_sats(100.0, RATE), 1_000);
    }

    #[test]
    fn test_kes_to_sats_one_million_kes() {
        assert_eq!(RateOracle::kes_to_sats(1_000_000.0, RATE), 10_000_000);
    }

    #[test]
    fn test_kes_to_sats_rounding() {
        assert_eq!(RateOracle::kes_to_sats(1.0, RATE), 10);
    }

    #[test]
    fn test_kes_to_sats_zero_rate_returns_zero() {
        assert_eq!(RateOracle::kes_to_sats(1000.0, 0.0), 0);
    }
}