//! Safaricom Daraja API client.
//!
//! Implements:
//!   - OAuth2 bearer-token generation (cached for 55 min per Safaricom spec)
//!   - Lipa na M-Pesa Online (STK Push) — `POST mpesa/stkpush/v1/processrequest`
//!
//! Both sandbox and production environments are supported via `DarajaEnv`.
//!
//! Token caching uses a `tokio::sync::Mutex`-protected `Option<CachedToken>`.
//! The mutex is held only for the duration of a cache read + optional refresh,
//! so lock contention is negligible.

use crate::error::{AppError, AppResult};
use base64::Engine;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

// ── Environment ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DarajaEnv {
    Sandbox,
    Production,
}

impl DarajaEnv {
    pub fn base_url(self) -> &'static str {
        match self {
            Self::Sandbox => "https://sandbox.safaricom.co.ke",
            Self::Production => "https://api.safaricom.co.ke",
        }
    }

    pub fn from_str(s: &str) -> Self {
        if s.eq_ignore_ascii_case("production") {
            Self::Production
        } else {
            Self::Sandbox
        }
    }
}

// ── Token cache ───────────────────────────────────────────────────────────────

struct CachedToken {
    token: String,
    /// When this token was fetched. Daraja tokens expire after 3600 s;
    /// we treat them as expired after 3300 s (55 min) to give a safety margin.
    fetched_at: DateTime<Utc>,
}

impl CachedToken {
    fn is_valid(&self) -> bool {
        let age = Utc::now()
            .signed_duration_since(self.fetched_at)
            .num_seconds();
        age < 3300
    }
}

// ── STK Push types ────────────────────────────────────────────────────────────

/// Response from `POST mpesa/stkpush/v1/processrequest` on success.
#[derive(Debug, Deserialize)]
pub struct StkPushResponse {
    #[serde(rename = "MerchantRequestID")]
    pub merchant_request_id: String,
    #[serde(rename = "CheckoutRequestID")]
    pub checkout_request_id: String,
    #[serde(rename = "ResponseCode")]
    pub response_code: String,
    #[serde(rename = "ResponseDescription")]
    pub response_description: String,
    #[serde(rename = "CustomerMessage")]
    pub customer_message: String,
}

/// Daraja STK Push callback body.
#[derive(Debug, Deserialize, Serialize)]
pub struct StkCallback {
    #[serde(rename = "MerchantRequestID")]
    pub merchant_request_id: String,
    #[serde(rename = "CheckoutRequestID")]
    pub checkout_request_id: String,
    /// 0 = success; anything else = failure.
    #[serde(rename = "ResultCode")]
    pub result_code: i32,
    #[serde(rename = "ResultDesc")]
    pub result_desc: String,
    #[serde(rename = "CallbackMetadata")]
    pub callback_metadata: Option<StkCallbackMetadata>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StkCallbackMetadata {
    #[serde(rename = "Item")]
    pub items: Vec<StkMetaItem>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StkMetaItem {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Value")]
    pub value: Option<serde_json::Value>,
}

impl StkCallbackMetadata {
    /// Extract a named value from the metadata item list.
    fn get(&self, name: &str) -> Option<&serde_json::Value> {
        self.items
            .iter()
            .find(|i| i.name == name)
            .and_then(|i| i.value.as_ref())
    }

    pub fn receipt_number(&self) -> Option<String> {
        self.get("MpesaReceiptNumber")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
    }

    pub fn phone_number(&self) -> Option<String> {
        self.get("PhoneNumber").and_then(|v| {
            v.as_str()
                .map(str::to_owned)
                .or_else(|| v.as_u64().map(|n| n.to_string()))
        })
    }

    #[allow(dead_code)]
    pub fn amount(&self) -> Option<f64> {
        self.get("Amount").and_then(|v| v.as_f64())
    }
}

// ── Client ────────────────────────────────────────────────────────────────────

pub struct MpesaClient {
    http: Client,
    env: DarajaEnv,
    consumer_key: String,
    consumer_secret: String,
    pub shortcode: String,
    passkey: String,
    pub callback_url: String,
    token_cache: Arc<Mutex<Option<CachedToken>>>,
}

impl MpesaClient {
    pub fn new(
        http: Client,
        env: DarajaEnv,
        consumer_key: String,
        consumer_secret: String,
        shortcode: String,
        passkey: String,
        callback_url: String,
    ) -> Self {
        Self {
            http,
            env,
            consumer_key,
            consumer_secret,
            shortcode,
            passkey,
            callback_url,
            token_cache: Arc::new(Mutex::new(None)),
        }
    }

    // ── OAuth2 token ──────────────────────────────────────────────────────────

    /// Fetch a fresh bearer token from Daraja.
    async fn fetch_token(&self) -> AppResult<String> {
        let credentials = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", self.consumer_key, self.consumer_secret));

        let url = format!(
            "{}/oauth/v1/generate?grant_type=client_credentials",
            self.env.base_url()
        );

        #[derive(Deserialize)]
        struct TokenResp {
            access_token: String,
        }

        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Basic {}", credentials))
            .send()
            .await
            .map_err(|e| {
                AppError::Internal(anyhow::anyhow!("Daraja token request failed: {}", e))
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "Daraja token endpoint returned {}: {}",
                status,
                body
            )));
        }

        let token_resp: TokenResp = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Daraja token parse error: {}", e)))?;

        Ok(token_resp.access_token)
    }

    /// Return a valid bearer token, refreshing if the cache is stale.
    async fn get_token(&self) -> AppResult<String> {
        let mut cache = self.token_cache.lock().await;

        if let Some(cached) = cache.as_ref() {
            if cached.is_valid() {
                return Ok(cached.token.clone());
            }
        }

        let token = self.fetch_token().await?;
        *cache = Some(CachedToken {
            token: token.clone(),
            fetched_at: Utc::now(),
        });
        Ok(token)
    }

    // ── STK Push ──────────────────────────────────────────────────────────────

    /// Initiate a Lipa na M-Pesa Online (STK Push) payment.
    ///
    /// - `buyer_phone`: E.164 without `+`, e.g. `254712345678`
    /// - `amount_kes`: rounded to nearest shilling (Daraja only accepts integers)
    /// - `account_ref`: shown on buyer's phone; use order ID or seller name
    /// - `description`: short transaction description (≤13 chars recommended)
    pub async fn stk_push(
        &self,
        buyer_phone: &str,
        amount_kes: u64,
        account_ref: &str,
        description: &str,
    ) -> AppResult<StkPushResponse> {
        let token = self.get_token().await?;

        // Password = base64(shortcode + passkey + timestamp)
        let timestamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
        let password_raw = format!("{}{}{}", self.shortcode, self.passkey, timestamp);
        let password = base64::engine::general_purpose::STANDARD.encode(password_raw);

        // Clamp description to 13 chars — Daraja rejects longer values
        let desc = if description.len() > 13 {
            &description[..13]
        } else {
            description
        };

        let body = serde_json::json!({
            "BusinessShortCode": self.shortcode,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": amount_kes,
            "PartyA": buyer_phone,
            "PartyB": self.shortcode,
            "PhoneNumber": buyer_phone,
            "CallBackURL": self.callback_url,
            "AccountReference": account_ref,
            "TransactionDesc": desc,
        });

        let url = format!("{}/mpesa/stkpush/v1/processrequest", self.env.base_url());

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Daraja STK Push failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            // Daraja error bodies often have a useful `errorMessage` field
            let msg = serde_json::from_str::<serde_json::Value>(&body_text)
                .ok()
                .and_then(|v| {
                    v.get("errorMessage")
                        .or_else(|| v.get("ResultDesc"))
                        .and_then(|m| m.as_str())
                        .map(str::to_owned)
                })
                .unwrap_or(body_text);
            return Err(AppError::Internal(anyhow::anyhow!(
                "Daraja STK Push returned {}: {}",
                status,
                msg
            )));
        }

        let stk: StkPushResponse = resp.json().await.map_err(|e| {
            AppError::Internal(anyhow::anyhow!("Daraja STK Push parse error: {}", e))
        })?;

        if stk.response_code != "0" {
            return Err(AppError::Internal(anyhow::anyhow!(
                "Daraja STK Push error (code {}): {}",
                stk.response_code,
                stk.response_description
            )));
        }

        Ok(stk)
    }

    // ── B2C (Business to Customer) ────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    /// Send money from the business shortcode to a customer's M-Pesa wallet.
    ///
    /// Used for seller payouts after successful delivery, and for refunds when
    /// an admin resolves a dispute in the buyer's favour.
    ///
    /// - `phone`: E.164 without `+`, e.g. `254712345678`
    /// - `amount_kes`: whole shillings (Daraja rejects fractional amounts for B2C)
    /// - `initiator_name`: the Daraja API operator username
    /// - `security_credential`: initiator password encrypted with Safaricom's
    ///   public certificate (pre-computed; see MPESA_B2C_SECURITY_CREDENTIAL in config)
    /// - `result_url`: Daraja POSTs the outcome to this HTTPS URL
    /// - `timeout_url`: Daraja POSTs here when the request sits in queue too long
    /// - `occasion`: short label shown in transaction history (≤100 chars)
    pub async fn b2c_pay(
        &self,
        phone: &str,
        amount_kes: u64,
        initiator_name: &str,
        security_credential: &str,
        result_url: &str,
        timeout_url: &str,
        occasion: &str,
    ) -> AppResult<B2cResponse> {
        let token = self.get_token().await?;

        let remarks = if occasion.len() > 100 {
            &occasion[..100]
        } else {
            occasion
        };

        let body = serde_json::json!({
            "InitiatorName":       initiator_name,
            "SecurityCredential":  security_credential,
            "CommandID":           "BusinessPayment",
            "Amount":              amount_kes,
            "PartyA":              self.shortcode,
            "PartyB":              phone,
            "Remarks":             remarks,
            "QueueTimeOutURL":     timeout_url,
            "ResultURL":           result_url,
            "Occasion":            remarks,
        });

        let url = format!("{}/mpesa/b2c/v1/paymentrequest", self.env.base_url());

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Daraja B2C request failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            let msg = serde_json::from_str::<serde_json::Value>(&body_text)
                .ok()
                .and_then(|v| {
                    v.get("errorMessage")
                        .or_else(|| v.get("ResultDesc"))
                        .and_then(|m| m.as_str())
                        .map(str::to_owned)
                })
                .unwrap_or(body_text);
            return Err(AppError::Internal(anyhow::anyhow!(
                "Daraja B2C returned {}: {}",
                status,
                msg
            )));
        }

        let b2c: B2cResponse = resp.json().await.map_err(|e| {
            AppError::Internal(anyhow::anyhow!("Daraja B2C parse error: {}", e))
        })?;

        if b2c.response_code != "0" {
            return Err(AppError::Internal(anyhow::anyhow!(
                "Daraja B2C error (code {}): {}",
                b2c.response_code,
                b2c.response_description
            )));
        }

        Ok(b2c)
    }
}

// ── B2C response types ────────────────────────────────────────────────────────

/// Response from `POST mpesa/b2c/v1/paymentrequest` on success.
#[derive(Debug, Deserialize)]
pub struct B2cResponse {
    #[serde(rename = "ConversationID")]
    pub conversation_id: String,
    #[serde(rename = "OriginatorConversationID")]
    pub originator_conversation_id: String,
    #[serde(rename = "ResponseCode")]
    pub response_code: String,
    #[serde(rename = "ResponseDescription")]
    pub response_description: String,
}

/// B2C result callback body (Daraja POSTs this to `result_url`).
#[derive(Debug, Deserialize)]
pub struct B2cResult {
    #[serde(rename = "Result")]
    pub result: B2cResultBody,
}

#[derive(Debug, Deserialize)]
pub struct B2cResultBody {
    #[serde(rename = "ResultType")]
    #[allow(dead_code)]
    pub result_type: i32,
    #[serde(rename = "ResultCode")]
    pub result_code: i32,
    #[serde(rename = "ResultDesc")]
    pub result_desc: String,
    #[serde(rename = "OriginatorConversationID")]
    #[allow(dead_code)]
    pub originator_conversation_id: String,
    #[serde(rename = "ConversationID")]
    pub conversation_id: String,
    #[serde(rename = "TransactionID")]
    pub transaction_id: String,
    #[serde(rename = "ResultParameters")]
    pub result_parameters: Option<B2cResultParams>,
}

#[derive(Debug, Deserialize)]
pub struct B2cResultParams {
    #[serde(rename = "ResultParameter")]
    pub items: Vec<B2cResultItem>,
}

#[derive(Debug, Deserialize)]
pub struct B2cResultItem {
    #[serde(rename = "Key")]
    pub key: String,
    #[serde(rename = "Value")]
    pub value: Option<serde_json::Value>,
}

impl B2cResultParams {
    pub fn transaction_receipt(&self) -> Option<String> {
        self.items
            .iter()
            .find(|i| i.key == "TransactionReceipt")
            .and_then(|i| i.value.as_ref())
            .and_then(|v| v.as_str())
            .map(str::to_owned)
    }
}
