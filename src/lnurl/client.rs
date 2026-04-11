use crate::error::{AppError, AppResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

// ── LNURL-pay response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct LnurlPayParams {
    callback: String,
    #[serde(rename = "minSendable")]
    min_sendable: i64,
    #[serde(rename = "maxSendable")]
    max_sendable: i64,
    /// Raw metadata JSON string. sha256(metadata) must match the bolt11 description_hash.
    /// Captured here for future invoice verification — not used in the current call flow.
    #[allow(dead_code)]
    metadata: Option<String>,
    tag: String,
}

/// Extra info some wallets send back after generating an invoice (e.g. a thank-you message).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuccessAction {
    pub tag: String,             // "message", "url", "aes"
    pub message: Option<String>, // for tag="message"
    pub url: Option<String>,     // for tag="url"
    pub description: Option<String>,
}

#[derive(Deserialize)]
struct LnurlInvoiceResponse {
    pr: String,
    #[serde(rename = "successAction")]
    success_action: Option<SuccessAction>,
}

// ── Public result type ────────────────────────────────────────────────────────

/// Returned by `request_invoice()` — bolt11 plus optional wallet feedback.
#[derive(Debug, Clone)]
pub struct LnurlInvoice {
    pub bolt11: String,
    pub success_action: Option<SuccessAction>,
}

// ── Client ────────────────────────────────────────────────────────────────────

pub struct LnurlClient {
    http: Client,
}

impl LnurlClient {
    pub fn new(http: Client) -> Self {
        Self { http }
    }

    /// Ensure a LNURL endpoint URL uses HTTPS (required by spec for all
    /// non-localhost/onion URLs).
    fn require_https(url: &str) -> AppResult<()> {
        if url.starts_with("http://") {
            // Allow plaintext only for loopback during development
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

    /// Fetch LNURL-pay parameters from a Lightning Address (user@domain).
    async fn fetch_pay_params(&self, ln_address: &str) -> AppResult<LnurlPayParams> {
        let mut parts = ln_address.splitn(2, '@');
        let user = parts.next().filter(|s| !s.is_empty()).ok_or_else(|| {
            AppError::BadRequest("Invalid Lightning Address: missing user".into())
        })?;
        let domain = parts.next().filter(|s| !s.is_empty()).ok_or_else(|| {
            AppError::BadRequest("Invalid Lightning Address: missing domain".into())
        })?;

        let url = format!("https://{}/.well-known/lnurlp/{}", domain, user);
        // The well-known URL is always HTTPS by construction above; no extra
        // check needed here. The *callback* URL (from the wallet response) must
        // also be validated before we call it.

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

        let params: LnurlPayParams = resp
            .json()
            .await
            .map_err(|e| AppError::Lnurl(format!("Invalid LNURL-pay response: {}", e)))?;

        if params.tag != "payRequest" {
            return Err(AppError::Lnurl(format!(
                "Expected LNURL payRequest tag, got: {}",
                params.tag
            )));
        }

        // Callback URL from seller's wallet must also be HTTPS
        Self::require_https(&params.callback)?;

        Ok(params)
    }

    /// Request a bolt11 invoice for `amount_msats` millisatoshis from the
    /// given Lightning Address.
    ///
    /// Returns the full [`LnurlInvoice`] (bolt11 + optional successAction).
    pub async fn request_invoice(
        &self,
        ln_address: &str,
        amount_msats: i64,
    ) -> AppResult<LnurlInvoice> {
        let params = self.fetch_pay_params(ln_address).await?;

        if amount_msats < params.min_sendable {
            return Err(AppError::BadRequest(format!(
                "Amount {} msats is below the minimum {} msats for this wallet",
                amount_msats, params.min_sendable
            )));
        }
        if amount_msats > params.max_sendable {
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

        let inv: LnurlInvoiceResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Lnurl(format!("Invalid invoice response: {}", e)))?;

        if inv.pr.is_empty() {
            return Err(AppError::Lnurl("Received empty bolt11 invoice".into()));
        }

        // Log successAction if the wallet sent one (we relay it to the client)
        if let Some(ref sa) = inv.success_action {
            tracing::debug!(
                tag = %sa.tag,
                message = ?sa.message,
                url = ?sa.url,
                "LNURL successAction received from seller wallet"
            );
        }

        Ok(LnurlInvoice {
            bolt11: inv.pr,
            success_action: inv.success_action,
        })
    }
}
