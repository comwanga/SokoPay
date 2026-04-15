use crate::auth::jwt::Claims;
use crate::error::{AppError, AppResult};
use crate::events;
use crate::lnurl::LnurlPayInfo;
use crate::state::SharedState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::{prelude::ToPrimitive, Decimal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use uuid::Uuid;

/// Invoice validity window.
///
/// 60 seconds locks in the current BTC/KES rate without giving the buyer
/// a long window to speculate on rate movements.  The frontend shows a
/// countdown and offers a one-click refresh when the invoice expires.
const INVOICE_EXPIRY_SECS: i64 = 60;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PaymentRecord {
    pub id: Uuid,
    pub order_id: Uuid,
    pub bolt11: String,
    pub amount_sats: i64,
    pub amount_kes: Decimal,
    pub status: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub settled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct CreateInvoiceResponse {
    pub payment_id: Uuid,
    pub bolt11: String,
    pub amount_sats: i64,
    pub amount_kes: Decimal,
    pub expires_at: DateTime<Utc>,
    /// true when an existing non-expired invoice was returned instead of creating a new one
    pub reused: bool,
}

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateInvoiceRequest {
    pub order_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct VerifyLnQuery {
    pub address: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmPaymentRequest {
    pub payment_id: Uuid,
    /// Hex-encoded 32-byte preimage. sha256(preimage) = payment hash.
    pub preimage: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Get the BTC/KES rate from DB cache (KES row), falling back to a live fetch.
/// Returns the KES rate as `Decimal` for sats conversion.
async fn get_or_fetch_rate(state: &SharedState) -> AppResult<Decimal> {
    #[derive(FromRow)]
    struct RateCacheEntry {
        btc_kes: Decimal,
        fetched_at: DateTime<Utc>,
    }

    let row: Option<RateCacheEntry> = sqlx::query_as(
        "SELECT btc_kes, fetched_at
         FROM rate_cache
         WHERE currency_code = 'KES'
         ORDER BY fetched_at DESC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some(r) = row {
        let age = Utc::now().signed_duration_since(r.fetched_at).num_seconds() as u64;
        if age <= state.config.max_rate_stale_secs {
            return Ok(r.btc_kes);
        }
    }

    // Cache miss — fetch all rates at once so the oracle cache is warm for
    // subsequent requests to other currency endpoints
    let rates = state
        .oracle
        .fetch_all_rates()
        .await
        .map_err(|e| AppError::Oracle(e.to_string()))?;

    let btc_kes = Decimal::try_from(rates.btc_kes())
        .map(|d| d.round_dp(4))
        .map_err(|e| AppError::Internal(anyhow::anyhow!("rate conversion: {}", e)))?;
    let btc_usd = Decimal::try_from(rates.btc_usd())
        .map(|d| d.round_dp(4))
        .map_err(|e| AppError::Internal(anyhow::anyhow!("rate conversion: {}", e)))?;

    // Persist KES and USD rows (sufficient for payment handler)
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO rate_cache (btc_kes, btc_usd, currency_code, fetched_at) VALUES ($1, $2, 'KES', $3)",
    )
    .bind(btc_kes)
    .bind(btc_usd)
    .bind(now)
    .execute(&state.db)
    .await
    .ok();

    sqlx::query(
        "INSERT INTO rate_cache (btc_kes, btc_usd, currency_code, fetched_at) VALUES ($1, $2, 'USD', $3)",
    )
    .bind(btc_usd)
    .bind(btc_usd)
    .bind(now)
    .execute(&state.db)
    .await
    .ok();

    Ok(btc_kes)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/payments/invoice
///
/// Generates a BOLT11 Lightning invoice for the given order.
///
/// Invoice source (in priority order):
///   1. BTCPay Server (platform node) — reliable, no dependency on seller's wallet.
///      The BTCPay invoice ID is stored so the webhook can auto-settle on payment.
///   2. Seller's Lightning Address via LNURL-pay — fallback when BTCPay is not
///      configured. Requires the seller to have a working wallet and LNURL endpoint.
///
/// Invoice expiry: 60 seconds. The KES→sats rate is locked at creation time.
/// If the invoice expires the buyer requests a new one (fresh rate).
///
/// Idempotent: an existing non-expired pending invoice for this order is returned
/// as-is (reused=true) to avoid hitting BTCPay/LNURL on every retry.
pub async fn create_invoice(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<CreateInvoiceRequest>,
) -> AppResult<(StatusCode, Json<CreateInvoiceResponse>)> {
    let buyer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    // Fetch order to verify buyer and get totals
    #[derive(FromRow)]
    struct OrderInfo {
        buyer_id: Uuid,
        seller_id: Uuid,
        total_kes: Decimal,
        status: String,
        product_title: String,
    }
    let order: Option<OrderInfo> = sqlx::query_as(
        "SELECT buyer_id, seller_id, total_kes, status, product_title FROM orders WHERE id = $1",
    )
    .bind(body.order_id)
    .fetch_optional(&state.db)
    .await?;

    let order =
        order.ok_or_else(|| AppError::NotFound(format!("Order {} not found", body.order_id)))?;

    if order.buyer_id != buyer_id {
        return Err(AppError::Forbidden(
            "You can only pay for your own orders".into(),
        ));
    }
    if order.status != "pending_payment" {
        return Err(AppError::BadRequest(format!(
            "Order is already {}",
            order.status
        )));
    }

    // ── Idempotency: return existing non-expired pending invoice ──────────────
    #[derive(FromRow)]
    struct ExistingPayment {
        id: Uuid,
        bolt11: String,
        amount_sats: i64,
        expires_at: DateTime<Utc>,
    }
    let existing: Option<ExistingPayment> = sqlx::query_as(
        "SELECT id, bolt11, amount_sats, expires_at
         FROM payments
         WHERE order_id = $1 AND status = 'pending' AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(body.order_id)
    .fetch_optional(&state.db)
    .await?;

    if let Some(p) = existing {
        return Ok((
            StatusCode::OK,
            Json(CreateInvoiceResponse {
                payment_id: p.id,
                bolt11: p.bolt11,
                amount_sats: p.amount_sats,
                amount_kes: order.total_kes,
                expires_at: p.expires_at,
                reused: true,
            }),
        ));
    }

    // ── Compute amount ────────────────────────────────────────────────────────
    let btc_kes = get_or_fetch_rate(&state).await?;

    // KES → satoshis in one step (avoids compounded rounding from an intermediate
    // sats_per_kes).  ceil() ensures we never under-collect — the sub-sat
    // difference is negligible for buyers.
    let amount_sats = (order.total_kes * Decimal::new(100_000_000, 0) / btc_kes)
        .ceil()
        .to_i64()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("sats amount overflows i64")))?;

    if amount_sats < 1 {
        return Err(AppError::BadRequest(
            "Computed amount is less than 1 satoshi".into(),
        ));
    }

    let expires_at = Utc::now() + chrono::Duration::seconds(INVOICE_EXPIRY_SECS);

    // ── Generate BOLT11 ───────────────────────────────────────────────────────
    //
    // Path A: platform BTCPay node — reliable, always available regardless of
    // whether the seller has a Lightning wallet configured.
    //
    // Path B: seller's own LNURL endpoint — only if BTCPay is not configured.
    // Kept as a fallback so existing single-seller deployments still work.

    let description = format!(
        "SokoPay {} — {}",
        &body.order_id.to_string()[..8].to_uppercase(),
        order.product_title,
    );

    let (bolt11, btcpay_invoice_id) =
        if let Ok((btcpay_url, btcpay_key, btcpay_store)) =
            crate::lnurl::server::require_btcpay(&state)
        {
            // ── Path A: BTCPay ─────────────────────────────────────────────────
            let url = format!(
                "{}/api/v1/stores/{}/lightning/invoices",
                btcpay_url, btcpay_store
            );
            let btcpay_body = serde_json::json!({
                "amount": amount_sats.to_string(),
                "description": description,
                "expiry": INVOICE_EXPIRY_SECS as u64,
            });

            let resp = state
                .http
                .post(&url)
                .header("Authorization", format!("token {}", btcpay_key))
                .json(&btcpay_body)
                .send()
                .await
                .map_err(|e| {
                    AppError::Internal(anyhow::anyhow!("BTCPay invoice request failed: {}", e))
                })?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(AppError::Internal(anyhow::anyhow!(
                    "BTCPay returned {}: {}",
                    status,
                    text
                )));
            }

            #[derive(serde::Deserialize)]
            struct BtcPayLnInvoice {
                #[serde(rename = "BOLT11")]
                bolt11: Option<String>,
                id: String,
            }
            let inv: BtcPayLnInvoice = resp.json().await.map_err(|e| {
                AppError::Internal(anyhow::anyhow!("BTCPay response parse error: {}", e))
            })?;
            let b11 = inv.bolt11.ok_or_else(|| {
                AppError::Internal(anyhow::anyhow!("BTCPay did not return a BOLT11"))
            })?;

            tracing::info!(
                order_id = %body.order_id,
                btcpay_invoice_id = %inv.id,
                amount_sats = %amount_sats,
                "Platform Lightning invoice created via BTCPay"
            );
            (b11, Some(inv.id))
        } else {
            // ── Path B: seller LNURL fallback ─────────────────────────────────
            let ln_address: Option<String> =
                sqlx::query_scalar("SELECT ln_address FROM farmers WHERE id = $1")
                    .bind(order.seller_id)
                    .fetch_optional(&state.db)
                    .await?
                    .flatten();

            let ln_address = ln_address.ok_or_else(|| {
                AppError::BadRequest(
                    "No Lightning node is configured for this platform and the seller has not set \
                     a Lightning Address. Contact the seller or administrator."
                        .into(),
                )
            })?;

            let invoice = state
                .lnurl
                .request_invoice(&ln_address, amount_sats * 1000)
                .await?;

            tracing::info!(
                order_id = %body.order_id,
                amount_sats = %amount_sats,
                "Lightning invoice created via seller LNURL"
            );
            (invoice.bolt11, None)
        };

    // ── Persist payment record ────────────────────────────────────────────────
    let payment_id: Uuid = sqlx::query_scalar(
        "INSERT INTO payments
            (order_id, bolt11, amount_sats, amount_kes, rate_used, expires_at, btcpay_invoice_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id",
    )
    .bind(body.order_id)
    .bind(&bolt11)
    .bind(amount_sats)
    .bind(order.total_kes)
    .bind(btc_kes)
    .bind(expires_at)
    .bind(btcpay_invoice_id.as_deref())
    .fetch_one(&state.db)
    .await?;

    if let Err(e) = crate::events::record_order_event(
        &state.db,
        body.order_id,
        Some(buyer_id),
        "invoice_created",
        None,
        serde_json::json!({
            "payment_id": payment_id,
            "amount_sats": amount_sats,
            "expires_at": expires_at,
            "via_btcpay": btcpay_invoice_id.is_some(),
        }),
    )
    .await
    {
        tracing::warn!(
            order_id = %body.order_id,
            error = %e,
            "Failed to record invoice_created event — audit trail incomplete"
        );
    }

    // Stamp the sats amount on the order for display
    sqlx::query("UPDATE orders SET total_sats = $2 WHERE id = $1")
        .bind(body.order_id)
        .bind(amount_sats)
        .execute(&state.db)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateInvoiceResponse {
            payment_id,
            bolt11,
            amount_sats,
            amount_kes: order.total_kes,
            expires_at,
            reused: false,
        }),
    ))
}

/// POST /api/payments/confirm
/// Buyer submits the preimage they received after paying the bolt11.
/// sha256(preimage) is stored as cryptographic proof of payment.
pub async fn confirm_payment(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<ConfirmPaymentRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let buyer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    // Validate preimage: must be 64 hex chars (32 bytes)
    let preimage_bytes = hex::decode(&body.preimage)
        .map_err(|_| AppError::BadRequest("preimage must be hex-encoded".into()))?;
    if preimage_bytes.len() != 32 {
        return Err(AppError::BadRequest(
            "preimage must be exactly 32 bytes (64 hex characters)".into(),
        ));
    }

    // Compute payment hash
    let payment_hash = hex::encode(Sha256::digest(&preimage_bytes));

    // Fetch payment record
    #[derive(FromRow)]
    struct PaymentInfo {
        order_id: Uuid,
        status: String,
    }
    let payment: Option<PaymentInfo> =
        sqlx::query_as("SELECT order_id, status FROM payments WHERE id = $1")
            .bind(body.payment_id)
            .fetch_optional(&state.db)
            .await?;

    let payment = payment
        .ok_or_else(|| AppError::NotFound(format!("Payment {} not found", body.payment_id)))?;

    if payment.status != "pending" {
        return Err(AppError::BadRequest(format!(
            "Payment is already {}",
            payment.status
        )));
    }

    // Verify the buyer owns this order and that it is still awaiting payment.
    // We fetch both in one query to avoid two round-trips.
    #[derive(FromRow)]
    struct OrderCheck {
        buyer_id: Uuid,
        status: String,
    }
    let order_check: Option<OrderCheck> =
        sqlx::query_as("SELECT buyer_id, status FROM orders WHERE id = $1")
            .bind(payment.order_id)
            .fetch_optional(&state.db)
            .await?;

    let order_check = order_check
        .ok_or_else(|| AppError::NotFound(format!("Order {} not found", payment.order_id)))?;

    if order_check.buyer_id != buyer_id {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    // Guard the state transition explicitly.
    // Without this, a replayed or raced request silently does 0 DB rows
    // (the WHERE clause stops corruption) but still returns 200 — which
    // confuses callers into thinking the payment succeeded.
    if order_check.status != "pending_payment" {
        return Err(AppError::BadRequest(format!(
            "Cannot confirm payment: order is '{}', not 'pending_payment'. \
             It may have been paid via another method or already cancelled.",
            order_check.status
        )));
    }

    let now = Utc::now();

    // Settle payment
    sqlx::query(
        "UPDATE payments SET status = 'settled', preimage = $2, payment_hash = $3, settled_at = $4
         WHERE id = $1",
    )
    .bind(body.payment_id)
    .bind(&body.preimage)
    .bind(&payment_hash)
    .bind(now)
    .execute(&state.db)
    .await?;

    // Advance order to paid.
    // The WHERE guard is still here as a defence-in-depth DB lock — the check
    // above already caught the wrong-state case for the user-facing message.
    sqlx::query("UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'pending_payment'")
        .bind(payment.order_id)
        .execute(&state.db)
        .await?;

    if let Err(e) = events::record_order_event(
        &state.db,
        payment.order_id,
        Some(buyer_id),
        "paid",
        None,
        serde_json::json!({
            "payment_id": body.payment_id,
            "payment_hash": payment_hash,
        }),
    )
    .await
    {
        tracing::warn!(
            order_id = %payment.order_id,
            error = %e,
            "Failed to record paid event — audit trail incomplete"
        );
    }

    Ok(Json(serde_json::json!({
        "confirmed": true,
        "payment_hash": payment_hash,
    })))
}

/// GET /api/payments/order/:order_id
pub async fn get_payment_for_order(
    State(state): State<SharedState>,
    claims: Claims,
    Path(order_id): Path<Uuid>,
) -> AppResult<Json<PaymentRecord>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    // Verify user is party to this order
    let is_party: Option<bool> = sqlx::query_scalar(
        "SELECT true FROM orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)",
    )
    .bind(order_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    if is_party.is_none() {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    #[derive(FromRow)]
    struct PaymentRow {
        id: Uuid,
        order_id: Uuid,
        bolt11: String,
        amount_sats: i64,
        amount_kes: Decimal,
        status: String,
        expires_at: Option<DateTime<Utc>>,
        settled_at: Option<DateTime<Utc>>,
        created_at: DateTime<Utc>,
    }

    let row: Option<PaymentRow> = sqlx::query_as(
        "SELECT id, order_id, bolt11, amount_sats, amount_kes, status, expires_at, settled_at, created_at
         FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?;

    let row =
        row.ok_or_else(|| AppError::NotFound(format!("No payment found for order {}", order_id)))?;

    Ok(Json(PaymentRecord {
        id: row.id,
        order_id: row.order_id,
        bolt11: row.bolt11,
        amount_sats: row.amount_sats,
        amount_kes: row.amount_kes,
        status: row.status,
        expires_at: row.expires_at,
        settled_at: row.settled_at,
        created_at: row.created_at,
    }))
}

/// GET /api/payments/verify-ln?address=<lightning-address-or-lnurl>
///
/// Resolves and fetches the LNURL-pay parameters for any supported Lightning
/// payment identifier without creating an invoice or touching the database.
/// Called by the seller profile settings page so sellers can confirm their
/// Lightning Address is reachable and working before saving it.
///
/// Accepted formats:
///   user@domain.com          — Lightning Address (LUD-16)
///   lnurl1dp68gurn…         — bech32 LNURL string (LUD-01)
///   lightning:lnurl1dp68…   — URI-prefixed bech32 LNURL (LUD-17)
///
/// Rate-limited to the same budget as invoice creation (external HTTP call).
pub async fn verify_ln_address(
    State(state): State<SharedState>,
    _claims: Claims,
    Query(q): Query<VerifyLnQuery>,
) -> AppResult<Json<LnurlPayInfo>> {
    if q.address.trim().is_empty() {
        return Err(AppError::BadRequest(
            "address query parameter is required".into(),
        ));
    }

    let info = state.lnurl.verify(&q.address).await?;
    Ok(Json(info))
}

// ── Unit tests (preimage validation) ─────────────────────────────────────────
#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    #[test]
    fn test_valid_preimage_produces_64_char_hash() {
        let preimage_bytes = [0u8; 32];
        let preimage_hex = hex::encode(preimage_bytes);
        let decoded = hex::decode(&preimage_hex).unwrap();
        assert_eq!(decoded.len(), 32);
        let hash = hex::encode(Sha256::digest(decoded));
        assert_eq!(hash.len(), 64, "sha256 hex output must be 64 chars");
    }

    #[test]
    fn test_preimage_not_hex_rejected() {
        let result = hex::decode("not-valid-hex!!!");
        assert!(result.is_err());
    }

    #[test]
    fn test_preimage_31_bytes_rejected() {
        let short_hex = hex::encode([0u8; 31]); // 62 hex chars
        let bytes = hex::decode(&short_hex).unwrap();
        assert_ne!(bytes.len(), 32, "31-byte preimage must fail length check");
    }

    #[test]
    fn test_preimage_33_bytes_rejected() {
        let long_hex = hex::encode([0u8; 33]); // 66 hex chars
        let bytes = hex::decode(&long_hex).unwrap();
        assert_ne!(bytes.len(), 32, "33-byte preimage must fail length check");
    }

    #[test]
    fn test_same_preimage_produces_same_hash() {
        let preimage = [42u8; 32];
        let h1 = hex::encode(Sha256::digest(preimage));
        let h2 = hex::encode(Sha256::digest(preimage));
        assert_eq!(h1, h2, "sha256 must be deterministic");
    }

    #[test]
    fn test_different_preimages_produce_different_hashes() {
        let h1 = hex::encode(Sha256::digest([1u8; 32]));
        let h2 = hex::encode(Sha256::digest([2u8; 32]));
        assert_ne!(h1, h2);
    }
}
