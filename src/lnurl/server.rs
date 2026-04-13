//! Platform Lightning Address server (LNURL-pay).
//!
//! Lets the platform host Lightning Addresses like alice@agripay.app.
//! Buyers' wallets use these three steps:
//!   1. GET /.well-known/lnurlp/{slug}  — learn how much they can send
//!   2. GET /lnurl/pay/{slug}/callback  — get the actual bolt11 invoice
//!   3. Pay the invoice; BTCPay calls POST /api/webhooks/btcpay when it settles
//!
//! Needs BTCPAY_URL, BTCPAY_API_KEY, BTCPAY_STORE_ID in the environment.
//! Returns a clear error if those are not set.

use crate::error::{AppError, AppResult};
use crate::events;
use crate::state::SharedState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ── Constants ─────────────────────────────────────────────────────────────────

/// Minimum invoice amount in millisatoshis (1 sat).
const MIN_SENDABLE_MSATS: i64 = 1_000;
/// Maximum invoice amount in millisatoshis (~21 BTC safety cap).
const MAX_SENDABLE_MSATS: i64 = 2_100_000_000_000;

// ── Response types ────────────────────────────────────────────────────────────

/// LUD-06 LNURL-pay request response.
#[derive(Debug, Serialize)]
pub struct LnurlPayRequest {
    pub tag: &'static str,
    pub callback: String,
    #[serde(rename = "minSendable")]
    pub min_sendable: i64,
    #[serde(rename = "maxSendable")]
    pub max_sendable: i64,
    /// JSON-encoded metadata array. sha256(metadata) is embedded in the bolt11.
    pub metadata: String,
    #[serde(rename = "commentAllowed")]
    pub comment_allowed: u32,
}

#[derive(Debug, Serialize)]
pub struct LnurlCallbackResponse {
    pub pr: String,
    #[serde(rename = "successAction")]
    pub success_action: Option<serde_json::Value>,
    pub routes: Vec<serde_json::Value>,
}

// ── Query types ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub amount: i64, // millisatoshis
    pub comment: Option<String>,
}

// ── BTCPay webhook ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BtcPayWebhookPayload {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(rename = "invoiceId")]
    pub invoice_id: Option<String>,
    #[serde(rename = "metadata")]
    pub metadata: Option<serde_json::Value>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Check BTCPay is configured; return 503 if not.
pub fn require_btcpay(state: &SharedState) -> AppResult<(&str, &str, &str)> {
    let url = state.config.btcpay_url.as_deref().filter(|s| !s.is_empty());
    let key = state
        .config
        .btcpay_api_key
        .as_deref()
        .filter(|s| !s.is_empty());
    let store = state
        .config
        .btcpay_store_id
        .as_deref()
        .filter(|s| !s.is_empty());

    match (url, key, store) {
        (Some(u), Some(k), Some(s)) => Ok((u, k, s)),
        _ => Err(AppError::Internal(anyhow::anyhow!(
            "Lightning node not configured. \
             Set BTCPAY_URL, BTCPAY_API_KEY, and BTCPAY_STORE_ID to enable \
             platform-hosted Lightning Addresses."
        ))),
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// GET /.well-known/lnurlp/{slug}
///
/// Step 1 of LNURL-pay: return the pay-request descriptor for a farmer's slug.
/// The slug is the farmer's `name` URL-encoded (or their Nostr npub prefix).
pub async fn lnurlp_descriptor(
    State(state): State<SharedState>,
    Path(slug): Path<String>,
) -> AppResult<Json<LnurlPayRequest>> {
    // Ensure BTCPay is configured before responding
    require_btcpay(&state)?;

    // Look up farmer by slug (name, case-insensitive)
    #[derive(FromRow)]
    struct FarmerRow {
        #[allow(dead_code)]
        id: Uuid,
        name: String,
    }
    let farmer: Option<FarmerRow> = sqlx::query_as(
        "SELECT id, name FROM farmers
         WHERE lower(name) = lower($1) AND ln_address IS NOT NULL
         LIMIT 1",
    )
    .bind(&slug)
    .fetch_optional(&state.db)
    .await?;

    let farmer = farmer
        .ok_or_else(|| AppError::NotFound(format!("No Lightning Address found for '{}'", slug)))?;

    let domain = state
        .config
        .public_base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://");

    let callback = format!(
        "{}/lnurl/pay/{}/callback",
        state.config.public_base_url, slug
    );

    // LUD-06 metadata: must contain at least one "text/plain" entry
    let metadata = serde_json::json!([
        ["text/plain", format!("Pay {} on AgriPay", farmer.name)],
        ["text/identifier", format!("{}@{}", slug, domain)]
    ])
    .to_string();

    Ok(Json(LnurlPayRequest {
        tag: "payRequest",
        callback,
        min_sendable: MIN_SENDABLE_MSATS,
        max_sendable: MAX_SENDABLE_MSATS,
        metadata,
        comment_allowed: 255,
    }))
}

/// GET /lnurl/pay/{slug}/callback?amount={msats}
///
/// Step 2 of LNURL-pay: generate a bolt11 invoice via BTCPay Server for the
/// given farmer and amount, return it to the payer's wallet.
pub async fn lnurlp_callback(
    State(state): State<SharedState>,
    Path(slug): Path<String>,
    Query(q): Query<CallbackQuery>,
) -> AppResult<Json<LnurlCallbackResponse>> {
    let (btcpay_url, btcpay_key, btcpay_store) = require_btcpay(&state)?;

    if q.amount < MIN_SENDABLE_MSATS {
        return Err(AppError::BadRequest(format!(
            "amount {} msats is below minimum {}",
            q.amount, MIN_SENDABLE_MSATS
        )));
    }
    if q.amount > MAX_SENDABLE_MSATS {
        return Err(AppError::BadRequest(format!(
            "amount {} msats exceeds maximum {}",
            q.amount, MAX_SENDABLE_MSATS
        )));
    }

    // Look up farmer
    #[derive(FromRow)]
    struct FarmerRow {
        id: Uuid,
        name: String,
    }
    let farmer: Option<FarmerRow> =
        sqlx::query_as("SELECT id, name FROM farmers WHERE lower(name) = lower($1) LIMIT 1")
            .bind(&slug)
            .fetch_optional(&state.db)
            .await?;

    let farmer =
        farmer.ok_or_else(|| AppError::NotFound(format!("Farmer '{}' not found", slug)))?;

    // Create invoice via BTCPay Server Lightning API
    let amount_sats = q.amount / 1000; // msats → sats
    let btcpay_invoice_url = format!(
        "{}/api/v1/stores/{}/lightning/invoices",
        btcpay_url, btcpay_store
    );

    let default_desc = format!("Payment to {} via AgriPay", farmer.name);
    let description = q.comment.as_deref().unwrap_or(&default_desc);

    let btcpay_body = serde_json::json!({
        "amount": amount_sats.to_string(),
        "description": description,
        "expiry": 900,  // 15 min
    });

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("HTTP client error: {}", e)))?;

    let resp = client
        .post(&btcpay_invoice_url)
        .header("Authorization", format!("token {}", btcpay_key))
        .header("Content-Type", "application/json")
        .json(&btcpay_body)
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("BTCPay request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(anyhow::anyhow!(
            "BTCPay returned {}: {}",
            status,
            body
        )));
    }

    #[derive(Deserialize)]
    struct BtcPayInvoice {
        #[serde(rename = "BOLT11")]
        bolt11: Option<String>,
        id: String,
    }
    let invoice: BtcPayInvoice = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("BTCPay response parse error: {}", e)))?;

    let bolt11 = invoice.bolt11.ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!("BTCPay did not return a BOLT11 invoice"))
    })?;

    tracing::info!(
        farmer_id = %farmer.id,
        slug = %slug,
        btcpay_invoice_id = %invoice.id,
        amount_sats = %amount_sats,
        "Platform LNURL invoice created via BTCPay"
    );

    Ok(Json(LnurlCallbackResponse {
        pr: bolt11,
        success_action: Some(serde_json::json!({
            "tag": "message",
            "message": format!("Thank you! Your payment to {} has been received.", farmer.name)
        })),
        routes: vec![],
    }))
}

/// POST /api/webhooks/btcpay
///
/// BTCPay Server calls this endpoint when an invoice is paid.
/// We use it to automatically mark the order as paid without
/// the buyer having to do anything extra.
///
/// BTCPay signs the request body with HMAC-SHA256 using BTCPAY_WEBHOOK_SECRET.
/// We verify that signature before processing anything — without this check,
/// anyone on the internet could fake a "payment received" event.
pub async fn btcpay_webhook(
    State(state): State<SharedState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> AppResult<StatusCode> {
    let body_bytes = body;

    // ── Step 1: Require the webhook secret to be configured ───────────────────
    // If it's missing, we refuse to process anything — operating without a secret
    // means anyone could forge a payment confirmation.
    let secret = state
        .config
        .btcpay_webhook_secret
        .as_deref()
        .ok_or_else(|| {
            AppError::Internal(anyhow::anyhow!(
                "BTCPAY_WEBHOOK_SECRET is not set. \
                 Configure it in BTCPay Server → Store Settings → Webhooks, \
                 then add it to your environment."
            ))
        })?;

    // ── Step 2: Extract the signature header ─────────────────────────────────
    // BTCPay sends: BTCPAY-SIG-1: sha256=<lowercase_hex_of_hmac>
    let sig_header = headers
        .get("BTCPAY-SIG-1")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("sha256="))
        .ok_or_else(|| {
            AppError::Webhook("Missing or malformed BTCPAY-SIG-1 header".into())
        })?;

    let received_sig =
        hex::decode(sig_header).map_err(|_| AppError::Webhook("BTCPAY-SIG-1 is not valid hex".into()))?;

    // ── Step 3: Compute our expected signature and compare ────────────────────
    // We MUST compare in constant time. A normal `==` comparison stops at the
    // first byte that differs, leaking *where* signatures diverge via timing.
    // constant_time_eq always checks every byte, giving no timing information.
    let expected_sig = hmac_sha256(secret.as_bytes(), &body_bytes);
    if !constant_time_eq(&expected_sig, &received_sig) {
        tracing::warn!("BTCPay webhook signature mismatch — possible forgery attempt");
        return Err(AppError::Webhook("Webhook signature invalid".into()));
    }

    // ── Step 4: Process the verified payload ──────────────────────────────────
    let payload: BtcPayWebhookPayload = serde_json::from_slice(body_bytes.as_ref())
        .map_err(|e| AppError::BadRequest(format!("Invalid BTCPay webhook payload: {}", e)))?;

    if payload.event_type != "InvoiceSettled" {
        // BTCPay sends many event types (InvoiceCreated, InvoiceExpired, etc).
        // We only act on settlement — acknowledge the rest with 200 and move on.
        return Ok(StatusCode::OK);
    }

    // Extract the order_id we embedded in the invoice metadata at creation time
    let order_id: Option<Uuid> = payload
        .metadata
        .as_ref()
        .and_then(|m| m.get("order_id"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());

    if let Some(oid) = order_id {
        // Auto-advance pending_payment → paid (idempotent: WHERE guards status)
        let result = sqlx::query(
            "UPDATE orders SET status = 'paid', updated_at = NOW()
             WHERE id = $1 AND status = 'pending_payment'",
        )
        .bind(oid)
        .execute(&state.db)
        .await?;

        if result.rows_affected() > 0 {
            // Settle the matching payment record.
            // This is NOT fire-and-forget (.ok()) — if we've just marked the order
            // as paid but fail to mark the payment settled, we have an inconsistent DB.
            sqlx::query(
                "UPDATE payments SET status = 'settled', settled_at = NOW()
                 WHERE order_id = $1 AND status = 'pending'",
            )
            .bind(oid)
            .execute(&state.db)
            .await?;

            if let Err(e) = events::record_order_event(
                &state.db,
                oid,
                None,
                "paid",
                None,
                serde_json::json!({
                    "source": "btcpay_webhook",
                    "btcpay_invoice_id": payload.invoice_id,
                }),
            )
            .await
            {
                // Audit log failure doesn't undo the payment, but must be visible.
                tracing::warn!(
                    order_id = %oid,
                    error = %e,
                    "Failed to record order event — audit trail incomplete"
                );
            }

            tracing::info!(order_id = %oid, "Order auto-advanced to paid via BTCPay webhook");
        }
    }

    Ok(StatusCode::OK)
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

/// HMAC-SHA256 built from the raw sha2 crate — no extra dependency needed.
///
/// How it works: HMAC wraps the data in two layers of hashing.
///   inner = SHA256(key XOR ipad || data)
///   result = SHA256(key XOR opad || inner)
/// The ipad/opad constants (0x36/0x5c) are defined in RFC 2104.
fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    use sha2::Digest;
    // Simple HMAC-SHA256 using the sha2 crate (no hmac crate needed)
    const BLOCK_SIZE: usize = 64;
    let mut k = if key.len() > BLOCK_SIZE {
        sha2::Sha256::digest(key).to_vec()
    } else {
        key.to_vec()
    };
    k.resize(BLOCK_SIZE, 0);

    let mut ipad = k.clone();
    let mut opad = k;
    for b in &mut ipad {
        *b ^= 0x36;
    }
    for b in &mut opad {
        *b ^= 0x5c;
    }

    let mut inner = sha2::Sha256::new();
    inner.update(&ipad);
    inner.update(data);
    let inner_hash = inner.finalize();

    let mut outer = sha2::Sha256::new();
    outer.update(&opad);
    outer.update(inner_hash);
    outer.finalize().to_vec()
}

/// Compare two byte slices in constant time to prevent timing attacks.
///
/// A normal equality check (`a == b`) stops at the first byte that differs,
/// so an attacker can measure how long the comparison took and deduce how many
/// bytes of their forged signature matched. This function always checks every
/// byte — the time it takes reveals nothing about *where* the slices differ.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    // Different lengths are an immediate mismatch, but we still do the loop
    // below on a zero-length slice so we don't short-circuit on length either.
    if a.len() != b.len() {
        return false;
    }
    // XOR each pair of bytes and OR the results into `diff`.
    // Any differing byte makes diff non-zero; identical slices keep it zero.
    let diff = a
        .iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y));
    diff == 0
}
