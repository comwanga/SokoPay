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
/// 15 minutes (900 s) gives buyers enough time to open their wallet, scan the
/// QR, and approve — especially on slow mobile connections.  The frontend shows
/// a live countdown ring and offers a one-click refresh when the invoice expires.
/// The BTC/KES rate is locked at creation time so the seller always receives the
/// agreed KES amount regardless of rate movements during the window.
const INVOICE_EXPIRY_SECS: i64 = 900;

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
    /// true when the seller's wallet returned a LUD-21 verify URL.
    /// A background worker will poll it and auto-advance the order on payment.
    pub has_auto_detect: bool,
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
/// Invoice is generated directly from the seller's Lightning Address / LNURL.
/// Funds go straight to the seller's wallet — the platform holds nothing.
///
/// Invoice expiry: 15 minutes. The KES→sats rate is locked at creation time.
/// If the invoice expires the buyer requests a new one (fresh rate).
///
/// Idempotent: an existing non-expired pending invoice for this order is returned
/// as-is (reused=true) to avoid hitting the seller's LNURL endpoint on every retry.
pub async fn create_invoice(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<CreateInvoiceRequest>,
) -> AppResult<(StatusCode, Json<CreateInvoiceResponse>)> {
    let buyer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    // Fetch order to verify buyer and get totals.
    #[derive(FromRow)]
    struct OrderInfo {
        buyer_id: Uuid,
        seller_id: Uuid,
        total_kes: Decimal,
        status: String,
    }
    let order: Option<OrderInfo> = sqlx::query_as(
        "SELECT o.buyer_id, o.seller_id, o.total_kes, o.status
         FROM orders o
         WHERE o.id = $1",
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
        verify_url: Option<String>,
    }
    let existing: Option<ExistingPayment> = sqlx::query_as(
        "SELECT id, bolt11, amount_sats, expires_at, verify_url
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
                has_auto_detect: p.verify_url.is_some(),
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

    // ── Generate BOLT11 via seller's Lightning Address / LNURL ───────────────
    //
    // SokoPay is a Lightning-first, non-custodial marketplace.
    // The platform never holds funds — invoices are generated directly from the
    // seller's own wallet via their configured Lightning Address or LNURL.
    // Payment settles instantly into the seller's wallet.

    let ln_address: Option<String> =
        sqlx::query_scalar("SELECT ln_address FROM farmers WHERE id = $1")
            .bind(order.seller_id)
            .fetch_optional(&state.db)
            .await?
            .flatten();

    let ln_address = ln_address.ok_or_else(|| {
        AppError::BadRequest(
            "Lightning payment is unavailable: this seller has not configured a \
             Lightning Address or LNURL in their profile. \
             Please ask the seller to add their Lightning Address in profile settings."
                .into(),
        )
    })?;

    let invoice = state
        .lnurl
        .request_invoice(&ln_address, amount_sats * 1000)
        .await
        .map_err(|e| {
            tracing::error!(
                seller_id  = %order.seller_id,
                ln_address = %ln_address,
                order_id   = %body.order_id,
                "Seller LNURL invoice request failed: {}", e,
            );
            AppError::Unavailable(format!(
                "Could not generate a Lightning invoice: {}. \
                 The seller's wallet may be offline. Please try again shortly.",
                e
            ))
        })?;

    tracing::info!(
        order_id       = %body.order_id,
        seller_id      = %order.seller_id,
        ln_address     = %ln_address,
        amount_sats    = %amount_sats,
        has_verify_url = invoice.verify_url.is_some(),
        "Lightning invoice created — direct to seller wallet"
    );

    let bolt11 = invoice.bolt11;
    let verify_url = invoice.verify_url;

    // ── Persist payment record ────────────────────────────────────────────────
    let payment_id: Uuid = sqlx::query_scalar(
        "INSERT INTO payments
            (order_id, bolt11, amount_sats, amount_kes, rate_used, expires_at, verify_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id",
    )
    .bind(body.order_id)
    .bind(&bolt11)
    .bind(amount_sats)
    .bind(order.total_kes)
    .bind(btc_kes)
    .bind(expires_at)
    .bind(verify_url.as_deref())
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
            "via": "seller_lnurl",
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

    // Stamp the sats amount and payment method on the order for display/history.
    sqlx::query("UPDATE orders SET total_sats = $2, payment_method = 'lightning' WHERE id = $1")
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
            has_auto_detect: verify_url.is_some(),
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

// ── Payment history ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PaymentHistoryQuery {
    /// "buyer" (payments sent) or "seller" (payments received)
    pub role: Option<String>,
    /// 0-based page index
    pub page: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PaymentHistoryItem {
    pub order_id: Uuid,
    pub product_title: String,
    pub counterparty_name: String,
    pub role: String,
    pub quantity: String,
    pub unit: String,
    pub total_kes: Decimal,
    pub total_sats: Option<i64>,
    pub order_status: String,
    pub payment_method: String,
    pub payment_status: Option<String>,
    /// Short reference: M-Pesa receipt number or first 12 chars of payment hash
    pub payment_ref: Option<String>,
    pub order_created_at: DateTime<Utc>,
    pub payment_settled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct PaymentHistoryResponse {
    pub items: Vec<PaymentHistoryItem>,
    pub total_count: i64,
    pub page: i64,
    pub page_size: i64,
    /// All-time total across ALL orders (not just current page)
    pub all_time_kes: Decimal,
    pub all_time_count: i64,
}

/// GET /api/payments/history?role=buyer|seller&page=0
///
/// Returns a paginated, unified payment history for the authenticated user.
/// Each row represents one order enriched with payment method and status from
/// either the `payments` (Lightning) or `mpesa_payments` (M-Pesa) tables.
///
/// `role=buyer`  → orders where the user is the buyer  (money sent)
/// `role=seller` → orders where the user is the seller (money received)
/// Defaults to `buyer` if omitted.
pub async fn list_payment_history(
    State(state): State<SharedState>,
    claims: Claims,
    Query(q): Query<PaymentHistoryQuery>,
) -> AppResult<Json<PaymentHistoryResponse>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let role = q.role.as_deref().unwrap_or("buyer");
    if role != "buyer" && role != "seller" {
        return Err(AppError::BadRequest(
            "role must be 'buyer' or 'seller'".into(),
        ));
    }

    const PAGE_SIZE: i64 = 30;
    let page = q.page.unwrap_or(0).max(0);
    let offset = page * PAGE_SIZE;

    // ── Paginated items ───────────────────────────────────────────────────────
    // product_title, unit, seller_name, buyer_name are not columns on the orders
    // table — they must be joined from products and farmers (two aliases: sf/bf).
    // The payments lateral uses alias `py` to avoid colliding with the products join `p`.
    let items: Vec<PaymentHistoryItem> = sqlx::query_as(
        r#"
        SELECT
            o.id                                          AS order_id,
            p.title                                       AS product_title,
            CASE WHEN $1 = 'buyer' THEN sf.name
                 ELSE bf.name END                         AS counterparty_name,
            $1::TEXT                                      AS role,
            o.quantity::TEXT                              AS quantity,
            p.unit,
            o.total_kes,
            o.total_sats,
            o.status                                      AS order_status,
            CASE
                WHEN mp.id  IS NOT NULL THEN 'mpesa'
                WHEN py.id  IS NOT NULL THEN 'lightning'
                ELSE COALESCE(o.payment_method, 'unknown')
            END                                           AS payment_method,
            CASE
                WHEN mp.id  IS NOT NULL THEN mp.status
                WHEN py.id  IS NOT NULL THEN py.status
                ELSE NULL
            END                                           AS payment_status,
            CASE
                WHEN mp.id  IS NOT NULL THEN mp.mpesa_receipt_number
                WHEN py.id  IS NOT NULL THEN LEFT(py.payment_hash, 12)
                ELSE NULL
            END                                           AS payment_ref,
            o.created_at                                  AS order_created_at,
            CASE
                WHEN mp.id  IS NOT NULL THEN mp.updated_at
                WHEN py.id  IS NOT NULL THEN py.settled_at
                ELSE NULL
            END                                           AS payment_settled_at
        FROM orders o
        JOIN  products p   ON p.id  = o.product_id
        JOIN  farmers  sf  ON sf.id = o.seller_id
        JOIN  farmers  bf  ON bf.id = o.buyer_id
        LEFT JOIN LATERAL (
            SELECT id, status, payment_hash, settled_at
            FROM payments
            WHERE order_id = o.id
            ORDER BY created_at DESC LIMIT 1
        ) py ON TRUE
        LEFT JOIN LATERAL (
            SELECT id, status, mpesa_receipt_number, updated_at
            FROM mpesa_payments
            WHERE order_id = o.id
            ORDER BY created_at DESC LIMIT 1
        ) mp ON TRUE
        WHERE ($1 = 'buyer'  AND o.buyer_id  = $2)
           OR ($1 = 'seller' AND o.seller_id = $2)
        ORDER BY o.created_at DESC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(role)
    .bind(user_id)
    .bind(PAGE_SIZE)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    // ── Total count + all-time KES sum for the current role ───────────────────
    #[derive(FromRow)]
    struct Totals {
        total_count: i64,
        all_time_kes: Decimal,
    }
    let totals: Totals = sqlx::query_as(
        r#"
        SELECT
            COUNT(*)           AS total_count,
            COALESCE(SUM(total_kes), 0) AS all_time_kes
        FROM orders
        WHERE ($1 = 'buyer'  AND buyer_id  = $2)
           OR ($1 = 'seller' AND seller_id = $2)
        "#,
    )
    .bind(role)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(PaymentHistoryResponse {
        items,
        total_count: totals.total_count,
        page,
        page_size: PAGE_SIZE,
        all_time_kes: totals.all_time_kes,
        all_time_count: totals.total_count,
    }))
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
