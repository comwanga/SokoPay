//! M-Pesa STK Push payment handlers.
//!
//! Routes:
//!   POST /payments/mpesa/stk-push        — buyer initiates; triggers STK Push
//!   POST /payments/mpesa/callback        — Daraja webhook (no JWT auth)
//!   GET  /payments/mpesa/:checkout_id/status — buyer polls until confirmed

use crate::auth::jwt::Claims;
use crate::error::{AppError, AppResult};
use crate::events;
use crate::farmers::handlers::normalize_phone;
use crate::state::SharedState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StkPushRequest {
    pub order_id: Uuid,
    /// Buyer's phone number in any Kenyan format (will be normalised to E.164).
    pub phone: String,
}

#[derive(Debug, Serialize)]
pub struct StkPushInitResponse {
    pub mpesa_payment_id: Uuid,
    pub checkout_request_id: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct MpesaStatusResponse {
    pub status: String,
    pub mpesa_receipt_number: Option<String>,
    pub amount_kes: Decimal,
}

// ── Daraja callback wrapper ───────────────────────────────────────────────────

/// Daraja wraps the STK callback in a `Body` envelope.
#[derive(Debug, Deserialize)]
pub struct DarajaCallbackEnvelope {
    #[serde(rename = "Body")]
    pub body: DarajaCallbackBody,
}

#[derive(Debug, Deserialize)]
pub struct DarajaCallbackBody {
    #[serde(rename = "stkCallback")]
    pub stk_callback: crate::mpesa::client::StkCallback,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Security: Safaricom Daraja IP allowlist ───────────────────────────────────
//
// Daraja's STK Push callbacks originate from Safaricom's known server IPs.
// Accepting callbacks only from these addresses prevents external actors from
// faking payment success by POSTing crafted payloads to our callback URL.
//
// Source: Safaricom Developer Portal (last updated 2024).
// If a future Daraja migration adds new IPs, append them here.
pub(crate) const SAFARICOM_IP_ALLOWLIST: &[&str] = &[
    "196.201.214.200",
    "196.201.214.206",
    "196.201.213.114",
    "196.201.214.207",
    "196.201.214.208",
    "196.201.213.44",
    "196.201.212.127",
    "196.201.212.138",
    "196.201.212.129",
    "196.201.212.136",
    "196.201.212.74",
    "196.201.212.69",
];

/// Extract the caller's best-effort IP from proxy-forwarded headers.
/// We use the same trust order as TrustedIpExtractor in routes/mod.rs.
pub(crate) fn extract_caller_ip(headers: &HeaderMap) -> Option<String> {
    // CF-Connecting-IP or X-Real-IP (set by trusted proxies)
    if let Some(ip) = headers
        .get("CF-Connecting-IP")
        .or_else(|| headers.get("X-Real-IP"))
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(ip.to_string());
    }
    // Rightmost X-Forwarded-For entry (set by the nearest proxy)
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next_back())
        .map(|s| s.trim().to_string())
}

/// Returns true if `ip` is in the Safaricom allowlist.
/// When `MPESA_DISABLE_IP_FILTER=true` is set in the environment (for local
/// development / ngrok tunnels), this check is bypassed with a loud warning.
pub(crate) fn is_allowed_daraja_ip(ip: &str) -> bool {
    SAFARICOM_IP_ALLOWLIST.contains(&ip)
}

/// Confirm M-Pesa is configured; return 503 with a clear message if not.
fn require_mpesa(state: &SharedState) -> AppResult<&crate::mpesa::client::MpesaClient> {
    state.mpesa.as_ref().ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!(
            "M-Pesa is not configured. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, \
             MPESA_SHORTCODE, MPESA_PASSKEY, and MPESA_CALLBACK_URL."
        ))
    })
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// POST /api/payments/mpesa/stk-push
///
/// Validates the order, normalises the buyer's phone, then triggers a Daraja
/// STK Push. The buyer receives a PIN prompt on their phone within ~5 seconds.
/// A `mpesa_payments` row is inserted with status `pending`; the buyer polls
/// `GET /payments/mpesa/:checkout_id/status` until Daraja's callback arrives.
pub async fn initiate_stk_push(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<StkPushRequest>,
) -> AppResult<(StatusCode, Json<StkPushInitResponse>)> {
    let mpesa = require_mpesa(&state)?;

    let buyer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    // Load and validate order
    #[derive(FromRow)]
    struct OrderInfo {
        buyer_id: Uuid,
        seller_id: Uuid,
        total_kes: Decimal,
        status: String,
        product_title: String,
    }
    let order: Option<OrderInfo> = sqlx::query_as(
        "SELECT o.buyer_id, o.seller_id, o.total_kes, o.status, p.title AS product_title
         FROM orders o
         JOIN products p ON p.id = o.product_id
         WHERE o.id = $1",
    )
    .bind(body.order_id)
    .fetch_optional(&state.db)
    .await?;

    let order =
        order.ok_or_else(|| AppError::NotFound(format!("Order {} not found", body.order_id)))?;

    if order.buyer_id != buyer_id {
        return Err(AppError::Forbidden("Access denied".into()));
    }
    if order.status != "pending_payment" {
        return Err(AppError::BadRequest(format!(
            "Order is already {}",
            order.status
        )));
    }

    // Block a second STK Push while one is already waiting for the buyer's PIN.
    // The unique partial index on mpesa_payments(order_id) WHERE status='pending'
    // is the hard safety net, but checking here avoids sending a duplicate Daraja
    // request to the buyer's phone before we even hit the DB.
    let already_pending: Option<bool> = sqlx::query_scalar(
        "SELECT true FROM mpesa_payments WHERE order_id = $1 AND status = 'pending'",
    )
    .bind(body.order_id)
    .fetch_optional(&state.db)
    .await?;

    if already_pending.is_some() {
        return Err(AppError::Conflict("payment_already_in_progress".into()));
    }

    // Normalise phone to E.164 (254XXXXXXXXX)
    let phone = normalize_phone(&body.phone).map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Daraja only accepts integer amounts — round up to nearest shilling
    let amount_kes_ceil = order.total_kes.ceil();
    let amount_u64 = amount_kes_ceil
        .to_string()
        .parse::<u64>()
        .map_err(|_| AppError::Internal(anyhow::anyhow!("KES amount overflow")))?;

    if amount_u64 < 1 {
        return Err(AppError::BadRequest(
            "Order amount is less than KES 1".into(),
        ));
    }

    // Build account reference from order ID (first 8 chars) + seller name
    let seller_name: Option<String> = sqlx::query_scalar("SELECT name FROM farmers WHERE id = $1")
        .bind(order.seller_id)
        .fetch_optional(&state.db)
        .await?;
    let account_ref = format!(
        "{} {}",
        &body.order_id.to_string()[..8].to_uppercase(),
        seller_name.as_deref().unwrap_or("SokoPay")
    );
    // Daraja account reference max 12 chars
    let account_ref = if account_ref.len() > 12 {
        account_ref[..12].to_string()
    } else {
        account_ref
    };

    let description = order.product_title.as_str();

    // Trigger STK Push
    let stk = mpesa
        .stk_push(&phone, amount_u64, &account_ref, description)
        .await?;

    // Persist the pending payment record.
    // The unique partial index (order_id WHERE status='pending') is the last
    // guard against a concurrent request that slipped past the check above.
    let mpesa_payment_id: Uuid = sqlx::query_scalar(
        "INSERT INTO mpesa_payments
            (order_id, merchant_request_id, checkout_request_id, buyer_phone, amount_kes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id",
    )
    .bind(body.order_id)
    .bind(&stk.merchant_request_id)
    .bind(&stk.checkout_request_id)
    .bind(&phone)
    .bind(order.total_kes)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("mpesa_payments_order_pending_unique")
            || (msg.contains("unique") && msg.contains("mpesa_payments"))
        {
            tracing::warn!(
                order_id = %body.order_id,
                "Concurrent STK Push blocked by unique index"
            );
            AppError::Conflict("payment_already_in_progress".into())
        } else {
            AppError::Database(e)
        }
    })?;

    // Record event for audit trail
    if let Err(e) = events::record_order_event(
        &state.db,
        body.order_id,
        Some(buyer_id),
        "mpesa_stk_push_sent",
        None,
        serde_json::json!({
            "mpesa_payment_id": mpesa_payment_id,
            "checkout_request_id": stk.checkout_request_id,
            "buyer_phone_suffix": format!("...{}", &phone[phone.len().saturating_sub(4)..]),
            "amount_kes": amount_u64,
        }),
    )
    .await
    {
        tracing::warn!(
            order_id = %body.order_id,
            error = %e,
            "Failed to record mpesa_stk_push_sent event"
        );
    }

    // Set payment method on the order
    sqlx::query("UPDATE orders SET payment_method = 'mpesa' WHERE id = $1")
        .bind(body.order_id)
        .execute(&state.db)
        .await?;

    tracing::info!(
        order_id = %body.order_id,
        checkout_request_id = %stk.checkout_request_id,
        amount_kes = %amount_u64,
        "M-Pesa STK Push initiated"
    );

    Ok((
        StatusCode::CREATED,
        Json(StkPushInitResponse {
            mpesa_payment_id,
            checkout_request_id: stk.checkout_request_id,
            message: stk.customer_message,
        }),
    ))
}

/// POST /api/payments/mpesa/callback
///
/// Daraja calls this endpoint when the buyer completes or dismisses the push.
/// No JWT authentication — Safaricom's servers send this from their IP range.
///
/// Security controls applied (defence-in-depth):
///   1. IP allowlist — only Safaricom's known server IPs are accepted.
///      Set `MPESA_DISABLE_IP_FILTER=true` in .env to bypass for local dev / ngrok.
///   2. Structural validation — JSON must deserialise into the expected envelope.
///   3. Idempotency — checkout_request_id must exist in our DB, and must be pending.
pub async fn mpesa_callback(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(envelope): Json<DarajaCallbackEnvelope>,
) -> StatusCode {
    // ── IP allowlist ──────────────────────────────────────────────────────────
    let bypass = std::env::var("MPESA_DISABLE_IP_FILTER")
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if !bypass {
        let caller_ip = extract_caller_ip(&headers);
        match caller_ip.as_deref() {
            Some(ip) if is_allowed_daraja_ip(ip) => {
                tracing::debug!(ip = %ip, "Daraja callback from allowed IP");
            }
            Some(ip) => {
                tracing::warn!(
                    ip = %ip,
                    "Daraja callback rejected: IP not in Safaricom allowlist"
                );
                // Return 200 to avoid Daraja retrying indefinitely on a bad IP.
                // The payment stays pending and will be caught by the expiry worker.
                return StatusCode::OK;
            }
            None => {
                tracing::warn!("Daraja callback rejected: could not determine caller IP");
                return StatusCode::OK;
            }
        }
    } else {
        tracing::warn!("MPESA_DISABLE_IP_FILTER=true — Daraja IP allowlist bypassed (dev mode)");
    }

    let cb = envelope.body.stk_callback;

    tracing::info!(
        checkout_request_id = %cb.checkout_request_id,
        result_code = %cb.result_code,
        result_desc = %cb.result_desc,
        "Daraja STK Push callback received"
    );

    // Look up the pending payment record by checkout_request_id
    #[derive(FromRow)]
    struct MpesaPaymentRow {
        id: Uuid,
        order_id: Uuid,
        status: String,
    }
    let row: Option<MpesaPaymentRow> = sqlx::query_as(
        "SELECT id, order_id, status FROM mpesa_payments
         WHERE checkout_request_id = $1",
    )
    .bind(&cb.checkout_request_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let row = match row {
        Some(r) => r,
        None => {
            tracing::warn!(
                checkout_request_id = %cb.checkout_request_id,
                "Daraja callback for unknown checkout_request_id — ignoring"
            );
            return StatusCode::OK; // Always 200 to Daraja, even on unknown
        }
    };

    // Idempotency: don't re-process an already-settled payment
    if row.status != "pending" {
        tracing::debug!(
            checkout_request_id = %cb.checkout_request_id,
            status = %row.status,
            "Duplicate callback — already processed, ignoring"
        );
        return StatusCode::OK;
    }

    if cb.result_code == 0 {
        // ── Success path ──────────────────────────────────────────────────────
        let meta = cb.callback_metadata.as_ref();
        let receipt = meta.and_then(|m| m.receipt_number());
        let phone_used = meta.and_then(|m| m.phone_number());

        // Both writes must succeed together.
        // If the process dies between them the buyer is charged but the order
        // stays pending forever — wrapping them in one transaction prevents that.
        let mut tx = match state.db.begin().await {
            Ok(t) => t,
            Err(e) => {
                tracing::error!(
                    checkout_request_id = %cb.checkout_request_id,
                    order_id = %row.order_id,
                    error = %e,
                    "mpesa_callback: failed to begin transaction"
                );
                return StatusCode::INTERNAL_SERVER_ERROR;
            }
        };

        let update_result = sqlx::query(
            "UPDATE mpesa_payments
             SET status = 'paid',
                 mpesa_receipt_number = $2,
                 mpesa_phone_used = $3,
                 result_code = $4,
                 result_desc = $5
             WHERE id = $1 AND status = 'pending'",
        )
        .bind(row.id)
        .bind(&receipt)
        .bind(&phone_used)
        .bind(cb.result_code)
        .bind(&cb.result_desc)
        .execute(&mut *tx)
        .await;

        if let Err(e) = update_result {
            tracing::error!(
                checkout_request_id = %cb.checkout_request_id,
                order_id = %row.order_id,
                error = %e,
                "Failed to update mpesa_payment to paid — rolling back"
            );
            let _ = tx.rollback().await;
            return StatusCode::INTERNAL_SERVER_ERROR;
        }

        let order_result = sqlx::query(
            "UPDATE orders SET status = 'paid', updated_at = NOW()
             WHERE id = $1 AND status = 'pending_payment'",
        )
        .bind(row.order_id)
        .execute(&mut *tx)
        .await;

        if let Err(e) = order_result {
            tracing::error!(
                order_id = %row.order_id,
                error = %e,
                "Failed to advance order to paid after M-Pesa callback — rolling back"
            );
            let _ = tx.rollback().await;
            return StatusCode::INTERNAL_SERVER_ERROR;
        }

        if let Err(e) = tx.commit().await {
            tracing::error!(
                checkout_request_id = %cb.checkout_request_id,
                order_id = %row.order_id,
                error = %e,
                "mpesa_callback: transaction commit failed"
            );
            return StatusCode::INTERNAL_SERVER_ERROR;
        }

        if let Err(e) = events::record_order_event(
            &state.db,
            row.order_id,
            None,
            "paid",
            None,
            serde_json::json!({
                "source": "mpesa_callback",
                "mpesa_receipt": receipt,
                "checkout_request_id": cb.checkout_request_id,
            }),
        )
        .await
        {
            tracing::warn!(
                order_id = %row.order_id,
                error = %e,
                "Failed to record paid event after M-Pesa callback"
            );
        }

        crate::metrics::record_stk_push_result(true);
        tracing::info!(
            order_id = %row.order_id,
            receipt = ?receipt,
            "Order paid via M-Pesa"
        );
    } else {
        // ── Failure path ──────────────────────────────────────────────────────
        // ResultCode 1032 = user cancelled; 1037 = timeout; others = various failures
        let new_status = if cb.result_code == 1032 {
            "cancelled"
        } else {
            "failed"
        };

        let _ = sqlx::query(
            "UPDATE mpesa_payments
             SET status = $2, result_code = $3, result_desc = $4
             WHERE id = $1 AND status = 'pending'",
        )
        .bind(row.id)
        .bind(new_status)
        .bind(cb.result_code)
        .bind(&cb.result_desc)
        .execute(&state.db)
        .await;

        crate::metrics::record_stk_push_result(false);
        tracing::info!(
            order_id = %row.order_id,
            result_code = %cb.result_code,
            result_desc = %cb.result_desc,
            "M-Pesa payment not completed"
        );
    }

    StatusCode::OK
}

/// GET /api/payments/mpesa/:checkout_id/status
///
/// Buyer polls this every few seconds after the STK Push until the order
/// transitions out of `pending`. Returns the current status so the frontend
/// can show a spinner, success, or retry prompt.
pub async fn get_mpesa_status(
    State(state): State<SharedState>,
    claims: Claims,
    Path(checkout_id): Path<String>,
) -> AppResult<Json<MpesaStatusResponse>> {
    let buyer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    #[derive(FromRow)]
    struct MpRow {
        order_id: Uuid,
        status: String,
        mpesa_receipt_number: Option<String>,
        amount_kes: Decimal,
    }
    let row: Option<MpRow> = sqlx::query_as(
        "SELECT order_id, status, mpesa_receipt_number, amount_kes
         FROM mpesa_payments WHERE checkout_request_id = $1",
    )
    .bind(&checkout_id)
    .fetch_optional(&state.db)
    .await?;

    let row = row.ok_or_else(|| {
        AppError::NotFound(format!("No M-Pesa payment found for {}", checkout_id))
    })?;

    // Verify caller is the buyer on that order
    let is_buyer: Option<bool> =
        sqlx::query_scalar("SELECT true FROM orders WHERE id = $1 AND buyer_id = $2")
            .bind(row.order_id)
            .bind(buyer_id)
            .fetch_optional(&state.db)
            .await?;

    if is_buyer.is_none() {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    Ok(Json(MpesaStatusResponse {
        status: row.status,
        mpesa_receipt_number: row.mpesa_receipt_number,
        amount_kes: row.amount_kes,
    }))
}
