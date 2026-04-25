use crate::error::{AppError, AppResult};
use bech32::FromBase32;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

// ── LNURL-pay response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct LnurlPayParams {
    callback: String,
    /// Minimum payable amount in millisatoshis. Some wallets omit this or set 0.
    #[serde(rename = "minSendable", default)]
    min_sendable: i64,
    /// Maximum payable amount in millisatoshis.
    /// Some wallets (including Fedi) return 0 when they have no upper limit —
    /// non-standard but common. We treat 0 as "no limit enforced by us".
    #[serde(rename = "maxSendable", default)]
    max_sendable: i64,
    /// Raw metadata JSON string (array of [type, value] pairs per LUD-06).
    metadata: Option<String>,
    tag: String,
}

#[derive(Deserialize)]
struct LnurlInvoiceResponse {
    pr: String,
    /// LUD-21: verify URL returned by some wallets (Alby, LNbits, Blink, Coinos…).
    /// Polling GET on this URL returns {"settled": bool, "preimage": "..."}.
    verify: Option<String>,
}

// ── Public result types ───────────────────────────────────────────────────────

/// Returned by `request_invoice()` — bolt11 plus the optional LUD-21 verify URL.
#[derive(Debug, Clone)]
pub struct LnurlInvoice {
    pub bolt11: String,
    /// LUD-21 verify URL, if the seller's wallet supports it.
    /// A background worker polls this URL to auto-detect payment.
    pub verify_url: Option<String>,
}

/// Returned by `verify()` — the pay parameters the seller's wallet advertises.
/// Used by the frontend to show a confirmation preview before saving the address.
#[derive(Debug, Serialize)]
pub struct LnurlPayInfo {
    /// The normalised form of the address that was verified.
    pub address: String,
    /// Minimum receivable amount in satoshis (not millisats).
    pub min_sendable_sats: i64,
    /// Maximum receivable amount in satoshis.
    pub max_sendable_sats: i64,
    /// Human-readable description extracted from the `text/plain` metadata entry.
    pub description: String,
    /// The callback URL returned by the wallet (useful for debugging).
    pub callback: String,
}

// ── Client ────────────────────────────────────────────────────────────────────

pub struct LnurlClient {
    http: Client,
}

impl LnurlClient {
    pub fn new(http: Client) -> Self {
        Self { http }
    }

    // ── Format normalisation ──────────────────────────────────────────────────

    /// Decode a bech32-encoded LNURL string (LUD-01) into the underlying HTTPS URL.
    ///
    /// Input may be mixed-case (the spec requires case-folding before decoding).
    fn decode_bech32_lnurl(encoded: &str) -> AppResult<String> {
        let lower = encoded.to_ascii_lowercase();
        let (hrp, data, _variant) = bech32::decode(&lower)
            .map_err(|e| AppError::BadRequest(format!("Invalid bech32 LNURL: {}", e)))?;

        if hrp != "lnurl" {
            return Err(AppError::BadRequest(format!(
                "Not an LNURL string (expected hrp 'lnurl', got '{}')",
                hrp
            )));
        }

        let bytes = Vec::<u8>::from_base32(&data)
            .map_err(|e| AppError::BadRequest(format!("LNURL base32 decode error: {}", e)))?;

        String::from_utf8(bytes)
            .map_err(|_| AppError::BadRequest("Decoded LNURL is not valid UTF-8".into()))
    }

    /// Normalise any Lightning payment identifier into a fetchable HTTPS URL.
    ///
    /// Accepted formats:
    /// - `user@domain.com`          — Lightning Address (LUD-16)
    /// - `lnurl1dp68gurn…`          — bech32 LNURL string (LUD-01)
    /// - `lightning:lnurl1dp68…`    — URI-prefixed bech32 LNURL
    /// - `https://domain/lnurlp/u`  — direct LNURL endpoint (for testing)
    fn resolve_to_fetch_url(input: &str) -> AppResult<String> {
        let trimmed = input.trim();

        // Strip the optional `lightning:` URI scheme (LUD-17)
        let s = trimmed.strip_prefix("lightning:").unwrap_or(trimmed);

        // bech32 LNURL string (case-insensitive `lnurl1` prefix)
        if s.to_ascii_lowercase().starts_with("lnurl1") {
            let url = Self::decode_bech32_lnurl(s)?;
            if !url.starts_with("https://") && !url.starts_with("http://") {
                return Err(AppError::BadRequest(
                    "Decoded LNURL does not point to an HTTP(S) URL".into(),
                ));
            }
            return Ok(url);
        }

        // Lightning Address: user@domain.com  (LUD-16)
        if let Some(at) = s.find('@') {
            let user = &s[..at];
            let domain = &s[at + 1..];
            if user.is_empty() || domain.is_empty() {
                return Err(AppError::BadRequest(
                    "Invalid Lightning Address: both user and domain are required".into(),
                ));
            }
            return Ok(format!("https://{}/.well-known/lnurlp/{}", domain, user));
        }

        // Raw HTTPS URL (direct LNURL endpoint — useful in dev/testing)
        if s.starts_with("https://") || s.starts_with("http://") {
            return Ok(s.to_string());
        }

        Err(AppError::BadRequest(
            "Unrecognised format. Use user@domain.com, an lnurl1… bech32 string, \
             or an https:// URL."
                .into(),
        ))
    }

    /// Require HTTPS for production endpoints; allow HTTP only on loopback.
    fn require_https(url: &str) -> AppResult<()> {
        if url.starts_with("http://") {
            let is_loopback = url.contains("://localhost")
                || url.contains("://127.0.0.1")
                || url.contains("://[::1]");
            if !is_loopback {
                return Err(AppError::BadRequest(format!(
                    "LNURL endpoint must use HTTPS (got plain HTTP): {}",
                    url
                )));
            }
        }
        Ok(())
    }

    // ── Core HTTP fetch ───────────────────────────────────────────────────────

    /// Fetch LNURL-pay parameters from any supported Lightning payment identifier.
    async fn fetch_pay_params(&self, input: &str) -> AppResult<LnurlPayParams> {
        let url = Self::resolve_to_fetch_url(input)?;
        Self::require_https(&url)?;

        let resp = self
            .http
            .get(&url)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| AppError::Lnurl(format!("LNURL endpoint unreachable: {}", e)))?;

        if !resp.status().is_success() {
            return Err(AppError::Lnurl(format!(
                "LNURL endpoint returned HTTP {}",
                resp.status()
            )));
        }

        // Deserialize to a raw Value first so we can detect LNURL protocol-level
        // errors (LUD-06 §4: even HTTP 200 responses may carry
        // {"status":"ERROR","reason":"..."} instead of payRequest params).
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Lnurl(format!("LNURL endpoint returned non-JSON: {}", e)))?;

        if body
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.eq_ignore_ascii_case("error"))
            .unwrap_or(false)
        {
            let reason = body
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("no reason given");
            return Err(AppError::Lnurl(format!(
                "Lightning Address returned error: {}",
                reason
            )));
        }

        let params: LnurlPayParams = serde_json::from_value(body).map_err(|e| {
            AppError::Lnurl(format!(
                "Invalid LNURL-pay response (expected payRequest with callback, \
                 minSendable, maxSendable): {}",
                e
            ))
        })?;

        if params.tag != "payRequest" {
            return Err(AppError::Lnurl(format!(
                "Expected LNURL payRequest tag, got: {}",
                params.tag
            )));
        }

        // The callback URL returned by the seller's wallet must also be HTTPS.
        Self::require_https(&params.callback)?;

        Ok(params)
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Verify a Lightning payment address and return the pay parameters.
    ///
    /// Accepts all supported formats (see [`resolve_to_fetch_url`]).
    /// Used by the profile settings page so sellers can confirm their
    /// wallet is reachable before saving the address.
    pub async fn verify(&self, address: &str) -> AppResult<LnurlPayInfo> {
        let params = self.fetch_pay_params(address).await?;

        // Extract the human-readable description from the metadata JSON array.
        // Metadata is a JSON-encoded array of [type, value] pairs (LUD-06 §3).
        // We look for the "text/plain" entry; fall back to a generic description.
        let description = params
            .metadata
            .as_deref()
            .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
            .and_then(|arr| {
                arr.as_array()?.iter().find_map(|pair| {
                    let p = pair.as_array()?;
                    if p.first()?.as_str()? == "text/plain" {
                        p.get(1)?.as_str().map(str::to_owned)
                    } else {
                        None
                    }
                })
            })
            .unwrap_or_else(|| format!("Payments to {}", address));

        Ok(LnurlPayInfo {
            address: address.trim().to_string(),
            min_sendable_sats: params.min_sendable / 1_000,
            // 0 means no limit — use a large sentinel so the UI shows "No limit"
            max_sendable_sats: if params.max_sendable > 0 {
                params.max_sendable / 1_000
            } else {
                i64::MAX
            },
            description,
            callback: params.callback,
        })
    }

    /// Request a bolt11 invoice for `amount_msats` millisatoshis from the
    /// given Lightning payment address.
    ///
    /// Returns the full [`LnurlInvoice`] (bolt11 + optional successAction).
    pub async fn request_invoice(
        &self,
        ln_address: &str,
        amount_msats: i64,
    ) -> AppResult<LnurlInvoice> {
        let params = self.fetch_pay_params(ln_address).await?;

        // Only enforce min when the wallet sets one above zero.
        if params.min_sendable > 0 && amount_msats < params.min_sendable {
            return Err(AppError::BadRequest(format!(
                "Amount {} msats is below the minimum {} msats for this wallet",
                amount_msats, params.min_sendable
            )));
        }
        // Only enforce max when the wallet sets a positive limit.
        // A value of 0 means the wallet did not specify an upper bound.
        if params.max_sendable > 0 && amount_msats > params.max_sendable {
            return Err(AppError::BadRequest(format!(
                "Amount {} msats exceeds the maximum {} msats for this wallet",
                amount_msats, params.max_sendable
            )));
        }

        let callback_url = format!("{}?amount={}", params.callback, amount_msats);

        let resp = self
            .http
            .get(&callback_url)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| AppError::Lnurl(format!("Invoice callback failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(AppError::Lnurl(format!(
                "Invoice callback returned HTTP {}",
                resp.status()
            )));
        }

        // Check for LNURL protocol error in callback response too (LUD-06 §5).
        let cb_body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Lnurl(format!("Invoice callback returned non-JSON: {}", e)))?;

        if cb_body
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.eq_ignore_ascii_case("error"))
            .unwrap_or(false)
        {
            let reason = cb_body
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("no reason given");
            return Err(AppError::Lnurl(format!(
                "Seller wallet rejected invoice request: {}",
                reason
            )));
        }

        let inv: LnurlInvoiceResponse = serde_json::from_value(cb_body)
            .map_err(|e| AppError::Lnurl(format!("Invalid invoice response: {}", e)))?;

        if inv.pr.is_empty() {
            return Err(AppError::Lnurl("Received empty bolt11 invoice".into()));
        }

        if inv.verify.is_some() {
            tracing::debug!(
                has_verify_url = true,
                "Wallet supports LUD-21 verify — auto-settle enabled"
            );
        }

        Ok(LnurlInvoice {
            bolt11: inv.pr,
            verify_url: inv.verify,
        })
    }
}
