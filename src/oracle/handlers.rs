use crate::error::{AppError, AppResult};
use crate::oracle::rate::SUPPORTED_CURRENCIES;
use crate::state::SharedState;
use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::HashMap;

// ── Request / response ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RateQuery {
    /// ISO-4217 currency code for local pricing display (default: USD).
    /// The rate is always anchored to BTC/USD; this selects what local
    /// currency prices are shown in (e.g. KES, NGN, EUR).
    pub currency: Option<String>,
}

/// Per-currency denomination of a single BTC amount.
#[derive(Debug, Serialize, Clone)]
pub struct CurrencyDenomination {
    /// ISO-4217 code (e.g. "KES", "USD").
    pub currency_code: String,
    /// BTC price in this currency (e.g. 105_000 for USD).
    pub btc_price: Decimal,
    /// 1 satoshi expressed in this currency (btc_price / 100_000_000).
    pub sats_price: Decimal,
}

#[derive(Debug, Serialize)]
pub struct RateResponse {
    // ── Primary: BTC/USD (global benchmark, always present) ──────────────────
    pub btc_usd: Decimal,
    /// 1 satoshi in USD.
    pub sats_usd: Decimal,

    // ── Requested local currency ──────────────────────────────────────────────
    /// Requested currency code (defaults to "USD" when no ?currency= given).
    pub local_currency: String,
    /// BTC price in the requested local currency.
    pub btc_local: Decimal,
    /// 1 satoshi in the requested local currency.
    pub sats_local: Decimal,

    // ── All denominations (for frontend multi-currency display) ───────────────
    /// One entry per supported currency with BTC price and sats price.
    pub denominations: Vec<CurrencyDenomination>,

    pub fetched_at: DateTime<Utc>,
    /// true = freshly fetched from CoinGecko, false = served from cache.
    pub live: bool,
}

#[derive(FromRow)]
struct RateCacheRow {
    btc_kes: Decimal, // repurposed: stores the rate for `currency_code`
    fetched_at: DateTime<Utc>,
    currency_code: String,
}

// ── Handler ───────────────────────────────────────────────────────────────────

/// GET /api/oracle/rate[?currency=KES]
///
/// Default denomination is USD (global benchmark). When `currency` is
/// provided (e.g. KES, NGN, EUR) the response also includes `btc_local` /
/// `sats_local` in that currency.
///
/// All denominations (all supported currencies) are always present in
/// `denominations` so the frontend can display prices in any currency without
/// a second round-trip.
pub async fn get_rate(
    State(state): State<SharedState>,
    Query(q): Query<RateQuery>,
) -> AppResult<Json<RateResponse>> {
    let local_currency = q
        .currency
        .as_deref()
        .unwrap_or("USD")
        .to_uppercase();

    // Validate requested currency
    if !SUPPORTED_CURRENCIES
        .iter()
        .any(|c| c.to_uppercase() == local_currency)
    {
        return Err(AppError::BadRequest(format!(
            "Unsupported currency '{}'. Supported: {}",
            local_currency,
            SUPPORTED_CURRENCIES
                .iter()
                .map(|c| c.to_uppercase())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }

    let cache_ttl = state.oracle.cache_ttl_secs as i64;

    // ── Try cache first ───────────────────────────────────────────────────────
    let cached_usd: Option<RateCacheRow> = sqlx::query_as(
        "SELECT btc_kes, fetched_at, currency_code
         FROM rate_cache
         WHERE currency_code = 'USD'
         ORDER BY fetched_at DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await?;

    let cache_age = cached_usd.as_ref().map(|r| {
        Utc::now()
            .signed_duration_since(r.fetched_at)
            .num_seconds()
    });

    let (rates_map, fetched_at, live) = if cache_age.map(|a| a < cache_ttl).unwrap_or(false) {
        // Cache is fresh — load all currencies from the same snapshot
        let snapshot_at = cached_usd.as_ref().unwrap().fetched_at;
        let rows: Vec<RateCacheRow> = sqlx::query_as(
            "SELECT btc_kes, fetched_at, currency_code
             FROM rate_cache
             WHERE fetched_at = $1",
        )
        .bind(snapshot_at)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let map: HashMap<String, Decimal> =
            rows.iter().map(|r| (r.currency_code.clone(), r.btc_kes)).collect();
        (map, snapshot_at, false)
    } else {
        // Fetch all rates from CoinGecko in one call
        match state.oracle.fetch_all_rates().await {
            Ok(rates) => {
                let now = Utc::now();
                let mut map = HashMap::new();

                for &code in SUPPORTED_CURRENCIES {
                    if let Some(rate_f64) = rates.get(code) {
                        if let Ok(rate_dec) = Decimal::try_from(rate_f64) {
                            let rate_dec = rate_dec.round_dp(4);
                            let code_upper = code.to_uppercase();

                            let usd_rate = Decimal::try_from(rates.btc_usd())
                                .map(|d| d.round_dp(4))
                                .unwrap_or(Decimal::ZERO);

                            sqlx::query(
                                "INSERT INTO rate_cache
                                     (btc_kes, btc_usd, currency_code, fetched_at)
                                 VALUES ($1, $2, $3, $4)",
                            )
                            .bind(rate_dec)
                            .bind(usd_rate)
                            .bind(&code_upper)
                            .bind(now)
                            .execute(&state.db)
                            .await
                            .ok();

                            map.insert(code_upper, rate_dec);
                        }
                    }
                }
                (map, now, true)
            }
            Err(e) => {
                tracing::warn!("Live rate fetch failed ({}), serving stale cache", e);
                // Fall back: load whatever is in the DB regardless of age
                let rows: Vec<RateCacheRow> = sqlx::query_as(
                    "SELECT DISTINCT ON (currency_code) btc_kes, fetched_at, currency_code
                     FROM rate_cache
                     ORDER BY currency_code, fetched_at DESC",
                )
                .fetch_all(&state.db)
                .await
                .unwrap_or_default();

                if rows.is_empty() {
                    return Err(AppError::Oracle(format!(
                        "Exchange rate unavailable: {}",
                        e
                    )));
                }
                let fetched_at = rows.iter().map(|r| r.fetched_at).max().unwrap_or(Utc::now());
                let map: HashMap<String, Decimal> =
                    rows.into_iter().map(|r| (r.currency_code, r.btc_kes)).collect();
                (map, fetched_at, false)
            }
        }
    };

    // ── Build response ────────────────────────────────────────────────────────
    let sats_divisor = Decimal::new(100_000_000, 0);

    let btc_usd = rates_map
        .get("USD")
        .copied()
        .unwrap_or(Decimal::ZERO);
    let sats_usd = if btc_usd > Decimal::ZERO {
        (btc_usd / sats_divisor).round_dp(8)
    } else {
        Decimal::ZERO
    };

    let btc_local = rates_map
        .get(&local_currency)
        .copied()
        .unwrap_or(btc_usd);
    let sats_local = if btc_local > Decimal::ZERO {
        (btc_local / sats_divisor).round_dp(8)
    } else {
        Decimal::ZERO
    };

    // Build one denomination entry per supported currency (sorted by code)
    let mut denominations: Vec<CurrencyDenomination> = SUPPORTED_CURRENCIES
        .iter()
        .filter_map(|&code| {
            let code_upper = code.to_uppercase();
            let btc_price = rates_map.get(&code_upper).copied()?;
            let sats_price = if btc_price > Decimal::ZERO {
                (btc_price / sats_divisor).round_dp(8)
            } else {
                Decimal::ZERO
            };
            Some(CurrencyDenomination {
                currency_code: code_upper,
                btc_price,
                sats_price,
            })
        })
        .collect();
    denominations.sort_by(|a, b| a.currency_code.cmp(&b.currency_code));

    Ok(Json(RateResponse {
        btc_usd,
        sats_usd,
        local_currency,
        btc_local,
        sats_local,
        denominations,
        fetched_at,
        live,
    }))
}
