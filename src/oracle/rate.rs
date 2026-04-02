use crate::config::Config;
use anyhow::Result;
use reqwest::Client;
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct ExchangeRate {
    pub btc_kes: f64,
    pub btc_usd: f64,
}

#[derive(Deserialize)]
struct CoinGeckoResponse {
    bitcoin: CoinGeckoPrices,
}

#[derive(Deserialize)]
struct CoinGeckoPrices {
    kes: f64,
    usd: f64,
}

pub struct RateOracle {
    http: Client,
    api_url: String,
    /// How many seconds a cached rate remains valid before a live fetch is attempted.
    cache_ttl_secs: u64,
}

impl RateOracle {
    pub fn new(config: &Config) -> Self {
        Self {
            http: Client::builder()
                .use_rustls_tls()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("Failed to build HTTP client"),
            api_url: config.coingecko_api_url.clone(),
            cache_ttl_secs: config.rate_cache_seconds,
        }
    }

    pub fn cache_ttl_secs(&self) -> u64 {
        self.cache_ttl_secs
    }

    pub async fn fetch_rate(&self) -> Result<ExchangeRate> {
        let url = format!(
            "{}/simple/price?ids=bitcoin&vs_currencies=kes,usd",
            self.api_url
        );

        let resp = self
            .http
            .get(&url)
            .header("User-Agent", "agri-pay/0.1")
            .send()
            .await?
            .json::<CoinGeckoResponse>()
            .await?;

        Ok(ExchangeRate {
            btc_kes: resp.bitcoin.kes,
            btc_usd: resp.bitcoin.usd,
        })
    }

    /// Convert KES amount to satoshis using the given BTC/KES rate.
    pub fn kes_to_sats(amount_kes: f64, btc_kes_rate: f64) -> u64 {
        if btc_kes_rate <= 0.0 {
            return 0;
        }
        let btc_amount = amount_kes / btc_kes_rate;
        let sats = btc_amount * 100_000_000.0;
        sats.round() as u64
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::RateOracle;

    // At a rate of 10_000_000 KES/BTC, 1 BTC costs 10M KES.
    // 100 KES = 0.00001 BTC = 1_000 sats.
    const RATE: f64 = 10_000_000.0;

    #[test]
    fn test_kes_to_sats_round_number() {
        assert_eq!(RateOracle::kes_to_sats(100.0, RATE), 1_000);
    }

    #[test]
    fn test_kes_to_sats_one_million_kes() {
        // 1_000_000 KES / 10_000_000 KES per BTC = 0.1 BTC = 10_000_000 sats
        assert_eq!(RateOracle::kes_to_sats(1_000_000.0, RATE), 10_000_000);
    }

    #[test]
    fn test_kes_to_sats_rounding() {
        // 1 KES at 10M rate = 10 sats (exact).
        assert_eq!(RateOracle::kes_to_sats(1.0, RATE), 10);
    }

    #[test]
    fn test_kes_to_sats_fractional_input() {
        // 50.5 KES at RATE: 50.5/10_000_000 * 1e8 = 505 sats exactly.
        assert_eq!(RateOracle::kes_to_sats(50.5, RATE), 505);
    }

    #[test]
    fn test_kes_to_sats_zero_rate_returns_zero() {
        assert_eq!(RateOracle::kes_to_sats(1000.0, 0.0), 0);
    }

    #[test]
    fn test_kes_to_sats_zero_amount() {
        assert_eq!(RateOracle::kes_to_sats(0.0, RATE), 0);
    }

    #[test]
    fn test_kes_to_sats_minimum_viable_payment() {
        // Min is 1000 sats → need 100 KES at this rate.
        assert!(RateOracle::kes_to_sats(100.0, RATE) >= 1000);
    }
}
