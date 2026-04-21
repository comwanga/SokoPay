//! Seller disbursement via Safaricom Daraja B2C.
//!
//! Flow:
//!   1. Order transitions to `confirmed` (buyer has received goods).
//!   2. `trigger_disbursement` is called (in a background task).
//!   3. We calculate the net payout, insert a `disbursements` row, then call B2C.
//!   4. Daraja POSTs the result to POST /api/payments/mpesa/b2c/result.
//!   5. The callback updates `disbursements.status` to `paid` or `failed`.
//!
//! If B2C is not configured, the disbursement row is created with
//! `manual_required` status so finance can process it through the portal.
//!
//! The reconciliation worker (`workers/disbursement.rs`) catches any rows
//! that stay in `pending` for more than 15 minutes (no callback received).

use crate::auth::jwt::{Claims, Role};
use crate::error::{AppError, AppResult};
use crate::mpesa::client::B2cResult;
use crate::mpesa::handlers::{extract_caller_ip, is_allowed_daraja_ip};
use crate::state::SharedState;
use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use chrono::{DateTime, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

// ── Disbursement trigger ──────────────────────────────────────────────────────

/// Called (in a background task) when an order transitions to `confirmed`.
///
/// Computes the seller's net payout, records a `disbursements` row, and fires
/// the Daraja B2C request. All errors are logged — nothing is propagated back
/// to the HTTP handler because the order is already confirmed at this point.
pub async fn trigger_disbursement(state: SharedState, order_id: Uuid) {
    if let Err(e) = try_trigger_disbursement(&state, order_id).await {
        tracing::error!(
            order_id = %order_id,
            error = %e,
            "Disbursement trigger failed — payout must be processed manually"
        );
    }
}

async fn try_trigger_disbursement(state: &SharedState, order_id: Uuid) -> AppResult<()> {
    // ── 1. Load order and seller details ──────────────────────────────────────
    #[derive(FromRow)]
    struct OrderPayout {
        seller_id: Uuid,
        total_kes: Decimal,
        #[allow(dead_code)]
        payment_method: Option<String>,
        seller_phone: Option<String>, // farmers.mpesa_phone
        seller_name: String,
    }

    let row: Option<OrderPayout> = sqlx::query_as(
        "SELECT o.seller_id,
                o.total_kes,
                o.payment_method,
                f.mpesa_phone  AS seller_phone,
                f.name         AS seller_name
         FROM orders o
         JOIN farmers f ON f.id = o.seller_id
         WHERE o.id = $1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await?;

    let order = match row {
        Some(r) => r,
        None => {
            tracing::error!(order_id = %order_id, "Disbursement: order not found");
            return Ok(());
        }
    };

    // ── 2. Calculate commission and net payout ────────────────────────────────
    let commission_rate = state.config.platform_commission_rate;
    let gross_kes = order.total_kes;
    let commission_kes = (gross_kes * commission_rate)
        .round_dp_with_strategy(2, rust_decimal::RoundingStrategy::MidpointAwayFromZero);
    let net_kes = gross_kes - commission_kes;

    // Round down to whole shillings for B2C (Daraja rejects fractional amounts)
    let net_kes_floor = net_kes.floor();
    let net_kes_u64 = net_kes_floor
        .to_u64()
        .ok_or_else(|| crate::error::AppError::Internal(anyhow::anyhow!("KES amount overflow")))?;

    if net_kes_u64 < 1 {
        tracing::warn!(
            order_id = %order_id,
            net_kes = %net_kes,
            "Disbursement: net payout < KES 1 after commission — skipping B2C"
        );
        return Ok(());
    }

    // Update order with commission info
    let _ =
        sqlx::query("UPDATE orders SET commission_kes = $2, commission_rate = $3 WHERE id = $1")
            .bind(order_id)
            .bind(commission_kes)
            .bind(commission_rate)
            .execute(&state.db)
            .await;

    // ── 3. Insert disbursement record ─────────────────────────────────────────
    // Use ON CONFLICT DO NOTHING for idempotency — if this fires twice (e.g.
    // from a duplicate status update), we don't double-pay the seller.
    let seller_phone = order.seller_phone.clone();
    let disbursement_id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO disbursements
             (order_id, seller_id, gross_kes, commission_kes, net_kes,
              commission_rate, seller_phone, status, disbursement_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'payout')
         ON CONFLICT (order_id, disbursement_type) DO NOTHING
         RETURNING id",
    )
    .bind(order_id)
    .bind(order.seller_id)
    .bind(gross_kes)
    .bind(commission_kes)
    .bind(net_kes)
    .bind(commission_rate)
    .bind(&seller_phone)
    .fetch_optional(&state.db)
    .await?;

    let disbursement_id = match disbursement_id {
        Some(id) => id,
        None => {
            // Row already exists (idempotent re-trigger) — nothing to do.
            tracing::debug!(order_id = %order_id, "Disbursement already exists — skipping");
            return Ok(());
        }
    };

    // ── 4. Check B2C is configured ────────────────────────────────────────────
    let (initiator, credential, result_url, timeout_url) = match (
        state.config.mpesa_b2c_initiator_name.as_deref(),
        state.config.mpesa_b2c_security_credential.as_deref(),
        state.config.mpesa_b2c_result_url.as_deref(),
        state.config.mpesa_b2c_timeout_url.as_deref(),
    ) {
        (Some(i), Some(c), Some(r), Some(t)) => (i, c, r, t),
        _ => {
            tracing::warn!(
                order_id   = %order_id,
                seller_id  = %order.seller_id,
                net_kes    = %net_kes,
                "B2C not configured — disbursement requires manual processing"
            );
            let _ = sqlx::query(
                "UPDATE disbursements SET status = 'manual_required',
                     notes = 'B2C not configured — process manually via Safaricom portal'
                 WHERE id = $1",
            )
            .bind(disbursement_id)
            .execute(&state.db)
            .await;
            return Ok(());
        }
    };

    // ── 5. Verify seller has an M-Pesa phone on file ──────────────────────────
    let phone = match seller_phone.as_deref().filter(|s| !s.is_empty()) {
        Some(p) => p.to_string(),
        None => {
            tracing::warn!(
                order_id  = %order_id,
                seller_id = %order.seller_id,
                "Seller has no M-Pesa phone — disbursement requires manual processing"
            );
            let _ = sqlx::query(
                "UPDATE disbursements SET status = 'manual_required',
                     notes = 'Seller has no M-Pesa phone on file'
                 WHERE id = $1",
            )
            .bind(disbursement_id)
            .execute(&state.db)
            .await;
            return Ok(());
        }
    };

    // ── 6. Check M-Pesa client is initialised ─────────────────────────────────
    let mpesa = match state.mpesa.as_ref() {
        Some(c) => c,
        None => {
            tracing::warn!(order_id = %order_id, "M-Pesa client not initialised — skipping B2C");
            let _ = sqlx::query(
                "UPDATE disbursements SET status = 'manual_required',
                     notes = 'M-Pesa client not configured on this server'
                 WHERE id = $1",
            )
            .bind(disbursement_id)
            .execute(&state.db)
            .await;
            return Ok(());
        }
    };

    // ── 7. Fire B2C payout ────────────────────────────────────────────────────
    let occasion = format!(
        "SokoPay payout {} {}",
        &order_id.to_string()[..8].to_uppercase(),
        order.seller_name
    );

    match mpesa
        .b2c_pay(
            &phone,
            net_kes_u64,
            initiator,
            credential,
            result_url,
            timeout_url,
            &occasion,
        )
        .await
    {
        Ok(b2c) => {
            tracing::info!(
                order_id        = %order_id,
                disbursement_id = %disbursement_id,
                conversation_id = %b2c.conversation_id,
                net_kes         = %net_kes_u64,
                seller_phone    = %phone,
                "B2C payout initiated"
            );
            let _ = sqlx::query(
                "UPDATE disbursements
                 SET status = 'processing',
                     b2c_conversation_id = $2,
                     b2c_originator_id   = $3
                 WHERE id = $1",
            )
            .bind(disbursement_id)
            .bind(&b2c.conversation_id)
            .bind(&b2c.originator_conversation_id)
            .execute(&state.db)
            .await;
        }
        Err(e) => {
            tracing::error!(
                order_id        = %order_id,
                disbursement_id = %disbursement_id,
                error           = %e,
                "B2C payout request failed"
            );
            let _ =
                sqlx::query("UPDATE disbursements SET status = 'failed', notes = $2 WHERE id = $1")
                    .bind(disbursement_id)
                    .bind(e.to_string())
                    .execute(&state.db)
                    .await;
        }
    }

    Ok(())
}

// ── B2C result callback ───────────────────────────────────────────────────────

/// POST /api/payments/mpesa/b2c/result
///
/// Daraja calls this after a B2C payment completes or fails.
/// We match by `ConversationID` and update the disbursements table.
///
/// Security: same Safaricom IP allowlist as the STK Push callback.
/// B2C result payloads are unsigned — IP filtering is the only
/// inbound control Daraja provides for this endpoint.
pub async fn b2c_result(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(payload): Json<B2cResult>,
) -> StatusCode {
    // ── IP allowlist ──────────────────────────────────────────────────────────
    let bypass = std::env::var("MPESA_DISABLE_IP_FILTER")
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if !bypass {
        match extract_caller_ip(&headers).as_deref() {
            Some(ip) if is_allowed_daraja_ip(ip) => {
                tracing::debug!(ip = %ip, "B2C result callback from allowed Safaricom IP");
            }
            Some(ip) => {
                tracing::warn!(
                    ip = %ip,
                    endpoint = "b2c_result",
                    "B2C result callback rejected: IP not in Safaricom allowlist"
                );
                return StatusCode::UNAUTHORIZED;
            }
            None => {
                tracing::warn!(
                    endpoint = "b2c_result",
                    "B2C result callback rejected: could not determine caller IP"
                );
                return StatusCode::UNAUTHORIZED;
            }
        }
    } else {
        tracing::warn!(
            "MPESA_DISABLE_IP_FILTER=true — Daraja B2C IP allowlist bypassed (dev mode)"
        );
    }

    let result = &payload.result;

    tracing::info!(
        conversation_id   = %result.conversation_id,
        result_code       = %result.result_code,
        result_desc       = %result.result_desc,
        transaction_id    = %result.transaction_id,
        "Daraja B2C result callback received"
    );

    // Find the disbursement row by conversation_id
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM disbursements WHERE b2c_conversation_id = $1")
            .bind(&result.conversation_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

    let (disbursement_id,) = match row {
        Some(r) => r,
        None => {
            tracing::warn!(
                conversation_id = %result.conversation_id,
                "B2C result for unknown conversation_id — ignoring"
            );
            return StatusCode::OK;
        }
    };

    if result.result_code == 0 {
        let receipt = result
            .result_parameters
            .as_ref()
            .and_then(|p| p.transaction_receipt());

        let _ = sqlx::query(
            "UPDATE disbursements
             SET status       = 'paid',
                 mpesa_receipt = $2,
                 result_code   = $3,
                 result_desc   = $4,
                 completed_at  = NOW()
             WHERE id = $1",
        )
        .bind(disbursement_id)
        .bind(&receipt)
        .bind(result.result_code)
        .bind(&result.result_desc)
        .execute(&state.db)
        .await
        .map_err(|e| tracing::error!(error = %e, "Failed to update disbursement to paid"));

        crate::metrics::record_disbursement_paid();
        tracing::info!(
            disbursement_id = %disbursement_id,
            receipt         = ?receipt,
            "Seller disbursement paid"
        );

        // Fire-and-forget email to the seller confirming their M-Pesa payout.
        if let Ok(Some((Some(email), seller_name, net_kes))) =
            sqlx::query_as::<_, (Option<String>, String, rust_decimal::Decimal)>(
                "SELECT f.email, f.name, d.net_kes
                 FROM disbursements d
                 JOIN farmers f ON f.id = d.seller_id
                 WHERE d.id = $1",
            )
            .bind(disbursement_id)
            .fetch_optional(&state.db)
            .await
        {
            let receipt_str = receipt.as_deref().unwrap_or("N/A");
            let (subj, body_text) = crate::notifications::email::disbursement_paid(
                &seller_name,
                &net_kes.to_string(),
                receipt_str,
            );
            crate::notifications::email::send_background(
                state.config.clone(),
                email,
                subj,
                body_text,
            );
        }
    } else {
        let _ = sqlx::query(
            "UPDATE disbursements
             SET status      = 'failed',
                 result_code  = $2,
                 result_desc  = $3,
                 notes        = $4
             WHERE id = $1",
        )
        .bind(disbursement_id)
        .bind(result.result_code)
        .bind(&result.result_desc)
        .bind(format!(
            "B2C ResultCode {}: {}",
            result.result_code, result.result_desc
        ))
        .execute(&state.db)
        .await
        .map_err(|e| tracing::error!(error = %e, "Failed to update disbursement to failed"));

        crate::metrics::record_disbursement_failed();
        tracing::warn!(
            disbursement_id = %disbursement_id,
            result_code     = %result.result_code,
            "B2C payout failed — manual intervention required"
        );
    }

    StatusCode::OK
}

// ── Admin disbursement list ───────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct DisbursementRow {
    pub id: Uuid,
    pub order_id: Uuid,
    pub seller_id: Uuid,
    pub seller_name: String,
    pub gross_kes: Decimal,
    pub commission_kes: Decimal,
    pub net_kes: Decimal,
    pub seller_phone: Option<String>,
    pub status: String,
    pub mpesa_receipt: Option<String>,
    pub result_code: Option<i32>,
    pub result_desc: Option<String>,
    pub notes: Option<String>,
    pub initiated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// GET /api/admin/disbursements
///
/// Admin-only view of all disbursements (most recent first, max 200).
/// Finance uses this to identify failed/manual payouts and process them.
pub async fn list_disbursements(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<Json<Vec<DisbursementRow>>> {
    if claims.role != Role::Admin {
        return Err(AppError::Forbidden("Admin access required".into()));
    }

    let rows: Vec<DisbursementRow> = sqlx::query_as(
        "SELECT d.id, d.order_id, d.seller_id,
                f.name        AS seller_name,
                d.gross_kes, d.commission_kes, d.net_kes,
                d.seller_phone, d.status,
                d.mpesa_receipt, d.result_code, d.result_desc,
                d.notes, d.initiated_at, d.completed_at
         FROM disbursements d
         JOIN farmers f ON f.id = d.seller_id
         ORDER BY d.initiated_at DESC
         LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// POST /api/payments/mpesa/b2c/timeout
///
/// Daraja calls this when a B2C request sits in the queue too long without
/// processing. We mark it `manual_required` so finance can re-initiate via
/// the Safaricom portal after confirming no funds were transferred.
///
/// Security: same Safaricom IP allowlist as the STK Push callback.
pub async fn b2c_timeout(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(payload): Json<B2cResult>,
) -> StatusCode {
    // ── IP allowlist ──────────────────────────────────────────────────────────
    let bypass = std::env::var("MPESA_DISABLE_IP_FILTER")
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if !bypass {
        match extract_caller_ip(&headers).as_deref() {
            Some(ip) if is_allowed_daraja_ip(ip) => {
                tracing::debug!(ip = %ip, "B2C timeout callback from allowed Safaricom IP");
            }
            Some(ip) => {
                tracing::warn!(
                    ip = %ip,
                    endpoint = "b2c_timeout",
                    "B2C timeout callback rejected: IP not in Safaricom allowlist"
                );
                return StatusCode::UNAUTHORIZED;
            }
            None => {
                tracing::warn!(
                    endpoint = "b2c_timeout",
                    "B2C timeout callback rejected: could not determine caller IP"
                );
                return StatusCode::UNAUTHORIZED;
            }
        }
    } else {
        tracing::warn!(
            "MPESA_DISABLE_IP_FILTER=true — Daraja B2C IP allowlist bypassed (dev mode)"
        );
    }

    let result = &payload.result;

    tracing::warn!(
        conversation_id = %result.conversation_id,
        "Daraja B2C timeout — request queued too long"
    );

    // Timeout does NOT mean the transfer failed — Daraja may still deliver
    // a late result callback. Using 'manual_required' keeps the row visible
    // to finance and the reconciliation worker without treating it as a
    // definitive failure. Only set 'failed' after confirming with Safaricom.
    let _ = sqlx::query(
        "UPDATE disbursements
         SET status = 'manual_required',
             notes  = 'Daraja B2C queue timeout — verify with Safaricom before re-initiating'
         WHERE b2c_conversation_id = $1 AND status = 'processing'",
    )
    .bind(&result.conversation_id)
    .execute(&state.db)
    .await
    .map_err(|e| tracing::error!(error = %e, "Failed to mark disbursement timed-out"));

    StatusCode::OK
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use crate::mpesa::handlers::{extract_caller_ip, is_allowed_daraja_ip, SAFARICOM_IP_ALLOWLIST};
    use axum::http::HeaderMap;

    /// A random public IP that is NOT in Safaricom's published server range.
    #[test]
    fn test_forged_ip_is_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "CF-Connecting-IP",
            "1.2.3.4".parse().expect("valid header value"),
        );
        let ip = extract_caller_ip(&headers).expect("IP should be extractable");
        assert!(
            !is_allowed_daraja_ip(&ip),
            "1.2.3.4 must not pass the Safaricom allowlist"
        );
    }

    /// First entry in SAFARICOM_IP_ALLOWLIST — must be accepted.
    #[test]
    fn test_safaricom_ip_is_allowed() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "CF-Connecting-IP",
            "196.201.214.200".parse().expect("valid header value"),
        );
        let ip = extract_caller_ip(&headers).expect("IP should be extractable");
        assert!(
            is_allowed_daraja_ip(&ip),
            "196.201.214.200 must be in the Safaricom allowlist"
        );
    }

    /// No IP headers present — extractor must return None so the guard fails closed.
    #[test]
    fn test_missing_ip_header_returns_none() {
        let headers = HeaderMap::new();
        assert!(
            extract_caller_ip(&headers).is_none(),
            "Missing IP headers must return None"
        );
    }

    /// Every address in the published Safaricom allowlist should be accepted.
    #[test]
    fn test_all_safaricom_ips_allowed() {
        for &ip in SAFARICOM_IP_ALLOWLIST {
            assert!(
                is_allowed_daraja_ip(ip),
                "{ip} is in SAFARICOM_IP_ALLOWLIST but is_allowed_daraja_ip returned false"
            );
        }
    }
}
