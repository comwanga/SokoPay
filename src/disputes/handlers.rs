use crate::auth::jwt::{Claims, Role};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::state::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

const MAX_REASON_LEN: usize = 1000;
const MAX_EVIDENCE_LEN: usize = 5000;

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct OpenDisputeRequest {
    /// Buyer's reason for the dispute (required).
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct AddEvidenceRequest {
    /// "text" | "image" | "url"
    pub kind: String,
    /// Text body, image URL, or external URL.
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ResolveDisputeRequest {
    /// "refund_buyer" | "release_seller" | "split"
    pub resolution: String,
    pub admin_notes: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct DisputeEvidence {
    pub id: Uuid,
    pub order_id: Uuid,
    pub submitter_id: Uuid,
    pub kind: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct OpenDispute {
    pub order_id: Uuid,
    pub dispute_reason: Option<String>,
    pub dispute_opened_at: Option<DateTime<Utc>>,
    pub total_kes: Decimal,
    pub total_sats: Option<i64>,
    pub seller_name: String,
    pub buyer_name: String,
    pub product_title: String,
    pub evidence_count: i64,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/orders/:id/dispute
///
/// Buyer opens a dispute on a delivered order. Transitions status from
/// `delivered` to `disputed` and records the reason.
pub async fn open_dispute(
    State(state): State<SharedState>,
    claims: Claims,
    Path(order_id): Path<Uuid>,
    Json(body): Json<OpenDisputeRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let reason = body.reason.trim().to_string();
    if reason.is_empty() {
        return Err(AppError::BadRequest("reason is required".into()));
    }
    if reason.len() > MAX_REASON_LEN {
        return Err(AppError::BadRequest(format!(
            "reason exceeds {} characters",
            MAX_REASON_LEN
        )));
    }

    #[derive(FromRow)]
    struct OrderMeta {
        buyer_id: Uuid,
        // Fetched alongside buyer_id so one query covers all access checks.
        // Not read directly here but kept for future seller-side dispute logic.
        #[allow(dead_code)]
        seller_id: Uuid,
        status: String,
    }
    let meta: Option<OrderMeta> =
        sqlx::query_as("SELECT buyer_id, seller_id, status FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&state.db)
            .await?;

    let meta = meta.ok_or_else(|| AppError::NotFound(format!("Order {} not found", order_id)))?;

    // Only the buyer can open a dispute, and only after seller marks delivered
    if meta.buyer_id != user_id {
        return Err(AppError::Forbidden(
            "Only the buyer can open a dispute".into(),
        ));
    }
    if meta.status != "delivered" {
        return Err(AppError::BadRequest(format!(
            "Disputes can only be opened on delivered orders (current status: {})",
            meta.status
        )));
    }

    let now = Utc::now();

    sqlx::query(
        "UPDATE orders SET
             status             = 'disputed',
             dispute_reason     = $2,
             dispute_opened_at  = $3,
             updated_at         = $3
         WHERE id = $1",
    )
    .bind(order_id)
    .bind(&reason)
    .bind(now)
    .execute(&state.db)
    .await?;

    if let Err(e) = events::record_order_event(
        &state.db,
        order_id,
        Some(user_id),
        "disputed",
        None,
        serde_json::json!({ "reason": reason }),
    )
    .await
    {
        tracing::warn!(
            order_id = %order_id,
            error = %e,
            "Failed to record disputed event — audit trail incomplete"
        );
    }

    crate::metrics::record_dispute_opened();

    // Notify both buyer and seller about the dispute (fire-and-forget).
    #[derive(sqlx::FromRow)]
    struct PartyInfo {
        seller_email: Option<String>,
        seller_name: String,
        buyer_email: Option<String>,
        buyer_name: String,
        product_title: String,
    }
    if let Ok(Some(info)) = sqlx::query_as::<_, PartyInfo>(
        "SELECT sf.email AS seller_email, sf.name AS seller_name,
                bf.email AS buyer_email,  bf.name AS buyer_name,
                p.title  AS product_title
         FROM orders o
         JOIN farmers sf  ON sf.id = o.seller_id
         JOIN farmers bf  ON bf.id = o.buyer_id
         JOIN products p  ON p.id  = o.product_id
         WHERE o.id = $1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    {
        let cfg = state.config.clone();
        let title = info.product_title.clone();
        if let Some(email) = info.seller_email {
            let (subj, body_text) =
                crate::notifications::email::dispute_opened(&info.seller_name, &title, true);
            crate::notifications::email::send_background(cfg.clone(), email, subj, body_text);
        }
        if let Some(email) = info.buyer_email {
            let (subj, body_text) =
                crate::notifications::email::dispute_opened(&info.buyer_name, &title, false);
            crate::notifications::email::send_background(cfg, email, subj, body_text);
        }
    }

    Ok(Json(serde_json::json!({
        "disputed": true,
        "order_id": order_id,
    })))
}

/// POST /api/orders/:id/dispute/evidence
///
/// Either party (buyer or seller) can submit evidence: text, image URL, or
/// external URL. Evidence is append-only and visible to admins.
pub async fn add_evidence(
    State(state): State<SharedState>,
    claims: Claims,
    Path(order_id): Path<Uuid>,
    Json(body): Json<AddEvidenceRequest>,
) -> AppResult<(StatusCode, Json<DisputeEvidence>)> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    if !["text", "image", "url"].contains(&body.kind.as_str()) {
        return Err(AppError::BadRequest(
            "kind must be 'text', 'image', or 'url'".into(),
        ));
    }
    let content = body.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::BadRequest("content is required".into()));
    }
    if content.len() > MAX_EVIDENCE_LEN {
        return Err(AppError::BadRequest(format!(
            "content exceeds {} characters",
            MAX_EVIDENCE_LEN
        )));
    }

    // Verify the order is disputed and the user is a party
    let is_party: Option<bool> = sqlx::query_scalar(
        "SELECT true FROM orders
         WHERE id = $1 AND status = 'disputed'
           AND (buyer_id = $2 OR seller_id = $2)",
    )
    .bind(order_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    if is_party.is_none() {
        return Err(AppError::Forbidden(
            "Order is not disputed or you are not a party to it".into(),
        ));
    }

    let evidence: DisputeEvidence = sqlx::query_as(
        "INSERT INTO dispute_evidence (order_id, submitter_id, kind, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id, order_id, submitter_id, kind, content, created_at",
    )
    .bind(order_id)
    .bind(user_id)
    .bind(&body.kind)
    .bind(&content)
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(evidence)))
}

/// GET /api/orders/:id/dispute/evidence
///
/// Both parties and admins can view evidence for a dispute they are party to.
pub async fn get_evidence(
    State(state): State<SharedState>,
    claims: Claims,
    Path(order_id): Path<Uuid>,
) -> AppResult<Json<Vec<DisputeEvidence>>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    // Admins can see all disputes; parties can see their own
    let accessible = if claims.role == Role::Admin {
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM orders WHERE id = $1)")
            .bind(order_id)
            .fetch_one(&state.db)
            .await?
    } else {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM orders
              WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2))",
        )
        .bind(order_id)
        .bind(user_id)
        .fetch_one(&state.db)
        .await?
    };

    if !accessible {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    let evidence: Vec<DisputeEvidence> = sqlx::query_as(
        "SELECT id, order_id, submitter_id, kind, content, created_at
         FROM dispute_evidence
         WHERE order_id = $1
         ORDER BY created_at ASC",
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(evidence))
}

/// GET /api/admin/disputes
///
/// Admin-only: paginated queue of open disputes, oldest first.
pub async fn list_open_disputes(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<Json<Vec<OpenDispute>>> {
    if claims.role != Role::Admin {
        return Err(AppError::Forbidden("Admin access required".into()));
    }

    #[derive(FromRow)]
    struct DisputeRow {
        order_id: Uuid,
        dispute_reason: Option<String>,
        dispute_opened_at: Option<DateTime<Utc>>,
        total_kes: Decimal,
        total_sats: Option<i64>,
        seller_name: String,
        buyer_name: String,
        product_title: String,
        evidence_count: i64,
    }

    let rows: Vec<DisputeRow> = sqlx::query_as(
        "SELECT
             o.id              AS order_id,
             o.dispute_reason,
             o.dispute_opened_at,
             o.total_kes,
             o.total_sats,
             sf.name           AS seller_name,
             bf.name           AS buyer_name,
             p.title           AS product_title,
             (SELECT COUNT(*) FROM dispute_evidence de WHERE de.order_id = o.id)::bigint
                               AS evidence_count
         FROM orders o
         JOIN farmers sf ON sf.id = o.seller_id
         JOIN farmers bf ON bf.id = o.buyer_id
         JOIN products p  ON p.id  = o.product_id
         WHERE o.status = 'disputed'
         ORDER BY o.dispute_opened_at ASC NULLS LAST
         LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;

    let disputes = rows
        .into_iter()
        .map(|r| OpenDispute {
            order_id: r.order_id,
            dispute_reason: r.dispute_reason,
            dispute_opened_at: r.dispute_opened_at,
            total_kes: r.total_kes,
            total_sats: r.total_sats,
            seller_name: r.seller_name,
            buyer_name: r.buyer_name,
            product_title: r.product_title,
            evidence_count: r.evidence_count,
        })
        .collect();

    Ok(Json(disputes))
}

/// PATCH /api/admin/disputes/:order_id/resolve
///
/// Admin resolves a dispute: refund_buyer | release_seller | split.
/// Does NOT move money — that happens externally (Lightning refund or no action).
/// Updates order status to `confirmed` or `cancelled` based on resolution.
pub async fn resolve_dispute(
    State(state): State<SharedState>,
    claims: Claims,
    Path(order_id): Path<Uuid>,
    Json(body): Json<ResolveDisputeRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if claims.role != Role::Admin {
        return Err(AppError::Forbidden("Admin access required".into()));
    }

    if !["refund_buyer", "release_seller", "split"].contains(&body.resolution.as_str()) {
        return Err(AppError::BadRequest(
            "resolution must be 'refund_buyer', 'release_seller', or 'split'".into(),
        ));
    }

    // Verify the order is still disputed
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await?;

    match status.as_deref() {
        Some("disputed") => {}
        Some(s) => {
            return Err(AppError::BadRequest(format!(
                "Order is not in disputed state (current: {})",
                s
            )))
        }
        None => return Err(AppError::NotFound(format!("Order {} not found", order_id))),
    }

    // Determine final order status based on resolution
    let final_status = match body.resolution.as_str() {
        "refund_buyer" => "cancelled", // seller ships nothing; buyer notified separately
        "release_seller" => "confirmed", // seller fulfilled; funds already in seller wallet
        "split" => "confirmed",        // partial; admin handles externally
        _ => unreachable!(),
    };

    let now = Utc::now();
    let admin_id = claims.farmer_id; // may be None for non-farmer admins

    sqlx::query(
        "UPDATE orders SET
             status                = $2,
             dispute_resolution    = $3,
             dispute_resolved_at   = $4,
             updated_at            = $4
         WHERE id = $1",
    )
    .bind(order_id)
    .bind(final_status)
    .bind(&body.resolution)
    .bind(now)
    .execute(&state.db)
    .await?;

    if let Err(e) = events::record_order_event(
        &state.db,
        order_id,
        admin_id,
        "dispute_resolved",
        body.admin_notes.as_deref(),
        serde_json::json!({
            "resolution": body.resolution,
            "final_status": final_status,
        }),
    )
    .await
    {
        tracing::warn!(
            order_id = %order_id,
            error = %e,
            "Failed to record dispute_resolved event — audit trail incomplete"
        );
    }

    crate::metrics::record_dispute_resolved();
    tracing::info!(
        order_id = %order_id,
        resolution = %body.resolution,
        "Dispute resolved by admin"
    );

    // Notify both buyer and seller via Nostr DM (best-effort, non-blocking).
    {
        #[derive(sqlx::FromRow)]
        struct Parties {
            buyer_nostr: Option<String>,
            seller_nostr: Option<String>,
            product_title: String,
        }
        if let Ok(Some(parties)) = sqlx::query_as::<_, Parties>(
            "SELECT bf.nostr_pubkey AS buyer_nostr,
                    sf.nostr_pubkey AS seller_nostr,
                    p.title         AS product_title
             FROM orders o
             JOIN farmers bf ON bf.id = o.buyer_id
             JOIN farmers sf ON sf.id = o.seller_id
             JOIN products p ON p.id  = o.product_id
             WHERE o.id = $1",
        )
        .bind(order_id)
        .fetch_optional(&state.db)
        .await
        {
            let base_msg = crate::notifications::nostr_dm::status_message(
                final_status,
                &parties.product_title,
                order_id,
            );
            let full_msg = format!(
                "{} Resolution: {}.",
                base_msg,
                body.resolution.replace('_', " ")
            );
            if let Some(key) = parties.buyer_nostr.filter(|s| !s.is_empty()) {
                let sc = state.clone();
                let msg = full_msg.clone();
                tokio::spawn(async move {
                    crate::notifications::nostr_dm::send_dm(&sc.config, &key, &msg).await;
                });
            }
            if let Some(key) = parties.seller_nostr.filter(|s| !s.is_empty()) {
                let sc = state.clone();
                tokio::spawn(async move {
                    crate::notifications::nostr_dm::send_dm(&sc.config, &key, &full_msg).await;
                });
            }
        }
    }

    // Trigger money movement based on resolution — all in background tasks so
    // the admin gets an immediate API response regardless of external call latency.
    match body.resolution.as_str() {
        "refund_buyer" => {
            // Try Lightning refund first; falls back to manual if M-Pesa was used.
            tokio::spawn(attempt_lightning_refund(state.clone(), order_id, now));
            // Also queue an M-Pesa B2C refund for M-Pesa orders.
            tokio::spawn(attempt_mpesa_refund_to_buyer(state.clone(), order_id));
        }
        "release_seller" => {
            // Seller fulfilled the order — disburse their payment now.
            tokio::spawn(crate::mpesa::b2c::trigger_disbursement(
                state.clone(),
                order_id,
            ));
        }
        "split" => {
            // Partial resolution: disburse to seller (admin handles buyer portion manually).
            // A real 50/50 split would require two B2C calls and partial commission logic;
            // for now we release full seller payout and note that the admin must manually
            // refund 50% to the buyer via the portal.
            tracing::info!(
                order_id = %order_id,
                "Dispute split: triggering seller disbursement — \
                 admin must manually refund buyer's 50% via Safaricom portal"
            );
            tokio::spawn(crate::mpesa::b2c::trigger_disbursement(
                state.clone(),
                order_id,
            ));
        }
        _ => {}
    }

    Ok(Json(serde_json::json!({
        "resolved": true,
        "order_id": order_id,
        "resolution": body.resolution,
        "final_status": final_status,
        // Tell the caller whether a refund attempt has been initiated.
        // They should poll payments.refund_status or check admin tooling.
        "refund_initiated": body.resolution == "refund_buyer",
    })))
}

// ── Refund helpers ────────────────────────────────────────────────────────────

/// Try to refund the buyer via Lightning.
///
/// Flow:
///   1. Find the settled payment and the buyer's Lightning address.
///   2. Ask the buyer's wallet for a fresh bolt11 invoice (via LNURL-pay).
///   3. Pay that invoice through BTCPay Server.
///   4. Record the outcome in payments.refund_status.
///
/// Every failure path writes a reason to payments.refund_notes so admins
/// know exactly why an automatic refund didn't complete.
async fn attempt_lightning_refund(state: SharedState, order_id: Uuid, resolved_at: DateTime<Utc>) {
    // ── 1. Fetch the payment record and buyer's Lightning address ─────────────
    #[derive(sqlx::FromRow)]
    struct RefundContext {
        payment_id: Uuid,
        total_sats: Option<i64>,
        payment_method: Option<String>,
        buyer_ln_address: Option<String>,
    }

    let ctx: Option<RefundContext> = sqlx::query_as(
        "SELECT p.id          AS payment_id,
                o.total_sats,
                o.payment_method,
                f.ln_address  AS buyer_ln_address
         FROM orders o
         JOIN farmers f  ON f.id = o.buyer_id
         JOIN payments p ON p.order_id = o.id AND p.status = 'settled'
         WHERE o.id = $1
         LIMIT 1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    let ctx = match ctx {
        Some(c) => c,
        None => {
            tracing::error!(
                order_id = %order_id,
                "Refund: could not find a settled payment for this order"
            );
            return;
        }
    };

    let total_sats = match ctx.total_sats.filter(|&s| s > 0) {
        Some(s) => s,
        None => {
            tracing::warn!(order_id = %order_id, "Refund: order has no sats amount");
            mark_refund(
                &state,
                ctx.payment_id,
                "manual_required",
                "Order has no sats amount — refund must be processed manually",
            )
            .await;
            return;
        }
    };

    // M-Pesa orders cannot be refunded via Lightning — flag immediately so the
    // admin can process the reversal through the Safaricom portal instead.
    if ctx.payment_method.as_deref() == Some("mpesa") {
        tracing::warn!(
            order_id = %order_id,
            "Refund: M-Pesa order — Lightning refund not applicable"
        );
        mark_refund(
            &state,
            ctx.payment_id,
            "manual_required",
            "Order was paid via M-Pesa — refund must be processed manually via M-Pesa reversal",
        )
        .await;
        return;
    }

    let buyer_ln_address = match ctx.buyer_ln_address.filter(|s| !s.is_empty()) {
        Some(addr) => addr,
        None => {
            tracing::warn!(order_id = %order_id, "Refund: buyer has no Lightning address on file");
            mark_refund(
                &state,
                ctx.payment_id,
                "manual_required",
                "Buyer has no Lightning address — refund must be processed manually",
            )
            .await;
            return;
        }
    };

    // ── 2. Get a fresh invoice from the buyer's wallet via LNURL-pay ──────────
    // We can't re-use the original bolt11 (it's already settled on their end).
    // Instead, we ask their wallet to generate a new receive invoice for the
    // refund amount, then we pay it out from the platform's BTCPay node.
    let amount_msats = total_sats * 1000; // sats → millisats
    let invoice = match state
        .lnurl
        .request_invoice(&buyer_ln_address, amount_msats)
        .await
    {
        Ok(inv) => inv,
        Err(e) => {
            tracing::error!(
                order_id = %order_id,
                buyer_ln_address = %buyer_ln_address,
                error = %e,
                "Refund: could not get invoice from buyer's Lightning wallet"
            );
            mark_refund(
                &state,
                ctx.payment_id,
                "failed",
                &format!("Could not get invoice from buyer wallet: {}", e),
            )
            .await;
            return;
        }
    };

    // ── 3. Check BTCPay is configured ─────────────────────────────────────────
    let (btcpay_url, btcpay_key, btcpay_store) = match (
        state.config.btcpay_url.as_deref().filter(|s| !s.is_empty()),
        state
            .config
            .btcpay_api_key
            .as_deref()
            .filter(|s| !s.is_empty()),
        state
            .config
            .btcpay_store_id
            .as_deref()
            .filter(|s| !s.is_empty()),
    ) {
        (Some(u), Some(k), Some(s)) => (u, k, s),
        _ => {
            tracing::error!(order_id = %order_id, "Refund: BTCPay not configured");
            mark_refund(
                &state,
                ctx.payment_id,
                "manual_required",
                "BTCPay Server not configured — refund must be sent manually",
            )
            .await;
            return;
        }
    };

    // ── 4. Pay the invoice through BTCPay ─────────────────────────────────────
    // BTCPay's Lightning pay endpoint takes a bolt11 and sends the payment
    // from the platform's connected Lightning node.
    let pay_url = format!(
        "{}/api/v1/stores/{}/lightning/BTC/invoices/pay",
        btcpay_url, btcpay_store
    );
    let pay_body = serde_json::json!({
        "BOLT11": invoice.bolt11,
        // Allow up to 2% routing fee — typical for well-connected nodes.
        "maxFeePercent": "2.0",
    });

    match state
        .http
        .post(&pay_url)
        .header("Authorization", format!("token {}", btcpay_key))
        .json(&pay_body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::info!(
                order_id = %order_id,
                total_sats = %total_sats,
                buyer_ln_address = %buyer_ln_address,
                "Refund: Lightning payment sent successfully to buyer"
            );
            // Record the completed refund — bolt11 is the proof of payment.
            let _ = sqlx::query(
                "UPDATE payments
                 SET refund_status = 'completed',
                     refund_bolt11  = $2,
                     refunded_at    = $3
                 WHERE id = $1",
            )
            .bind(ctx.payment_id)
            .bind(&invoice.bolt11)
            .bind(resolved_at)
            .execute(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(
                    payment_id = %ctx.payment_id,
                    error = %e,
                    "Refund: payment sent but failed to update refund_status in DB"
                )
            });
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::error!(
                order_id = %order_id,
                btcpay_status = %status,
                btcpay_body = %body,
                "Refund: BTCPay refused the Lightning payment"
            );
            mark_refund(
                &state,
                ctx.payment_id,
                "failed",
                &format!("BTCPay returned HTTP {}: {}", status, body),
            )
            .await;
        }
        Err(e) => {
            tracing::error!(order_id = %order_id, error = %e, "Refund: network error reaching BTCPay");
            mark_refund(
                &state,
                ctx.payment_id,
                "failed",
                &format!("Network error sending refund: {}", e),
            )
            .await;
        }
    }
}

/// Attempt a direct M-Pesa B2C refund to the buyer's registered phone.
///
/// This runs in parallel with `attempt_lightning_refund`. For M-Pesa orders,
/// only this path will succeed (the LN path exits early). For LN orders, this
/// path will exit early because the buyer has no M-Pesa phone in the common case.
///
/// Errors are always logged, never propagated — the dispute is already resolved.
async fn attempt_mpesa_refund_to_buyer(state: SharedState, order_id: Uuid) {
    #[derive(sqlx::FromRow)]
    struct RefundCtx {
        total_kes: Decimal,
        payment_method: Option<String>,
        buyer_phone: Option<String>,
        #[allow(dead_code)]
        buyer_name: String,
    }

    let ctx: Option<RefundCtx> = sqlx::query_as(
        "SELECT o.total_kes,
                o.payment_method,
                f.mpesa_phone   AS buyer_phone,
                f.name          AS buyer_name
         FROM orders o
         JOIN farmers f ON f.id = o.buyer_id
         WHERE o.id = $1",
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let ctx = match ctx {
        Some(c) => c,
        None => {
            tracing::error!(order_id = %order_id, "M-Pesa refund: order not found");
            return;
        }
    };

    // Only run for M-Pesa orders
    if ctx.payment_method.as_deref() != Some("mpesa") {
        return;
    }

    let phone = match ctx.buyer_phone.as_deref().filter(|s| !s.is_empty()) {
        Some(p) => p.to_string(),
        None => {
            tracing::warn!(
                order_id = %order_id,
                "M-Pesa refund: buyer has no M-Pesa phone on file — manual action required"
            );
            return;
        }
    };

    let (initiator, credential, result_url, timeout_url) = match (
        state.config.mpesa_b2c_initiator_name.as_deref(),
        state.config.mpesa_b2c_security_credential.as_deref(),
        state.config.mpesa_b2c_result_url.as_deref(),
        state.config.mpesa_b2c_timeout_url.as_deref(),
    ) {
        (Some(i), Some(c), Some(r), Some(t)) => (i, c, r, t),
        _ => {
            tracing::warn!(order_id = %order_id, "M-Pesa refund: B2C not configured — manual action required");
            return;
        }
    };

    let mpesa = match state.mpesa.as_ref() {
        Some(c) => c,
        None => {
            tracing::warn!(order_id = %order_id, "M-Pesa refund: client not initialised");
            return;
        }
    };

    use rust_decimal::prelude::ToPrimitive;
    let amount_u64 = match ctx.total_kes.floor().to_u64() {
        Some(a) if a > 0 => a,
        _ => {
            tracing::warn!(order_id = %order_id, "M-Pesa refund: invalid amount");
            return;
        }
    };

    let occasion = format!(
        "SokoPay refund {}",
        &order_id.to_string()[..8].to_uppercase()
    );

    match mpesa
        .b2c_pay(
            &phone,
            amount_u64,
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
                conversation_id = %b2c.conversation_id,
                amount_kes      = %amount_u64,
                buyer_phone     = %phone,
                "M-Pesa refund B2C initiated"
            );
        }
        Err(e) => {
            tracing::error!(
                order_id   = %order_id,
                error      = %e,
                "M-Pesa refund B2C failed — manual action required"
            );
        }
    }
}

/// Write a refund outcome to the payments table.
///
/// Every code path in `attempt_lightning_refund` that can't complete the refund
/// calls this so admins always have a clear record of what happened.
async fn mark_refund(state: &SharedState, payment_id: Uuid, status: &str, notes: &str) {
    let _ = sqlx::query("UPDATE payments SET refund_status = $2, refund_notes = $3 WHERE id = $1")
        .bind(payment_id)
        .bind(status)
        .bind(notes)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(
                payment_id = %payment_id,
                error = %e,
                "Failed to write refund status to DB"
            )
        });
}

// ── Stuck refund visibility ───────────────────────────────────────────────────

/// A resolved dispute whose automatic Lightning refund did not complete.
/// Admins must manually process these.
#[derive(Debug, Serialize)]
pub struct StuckRefund {
    pub order_id: Uuid,
    pub product_title: String,
    pub buyer_name: String,
    pub seller_name: String,
    pub total_kes: Decimal,
    pub total_sats: Option<i64>,
    pub payment_method: Option<String>,
    pub refund_status: String,
    pub refund_notes: Option<String>,
    pub dispute_resolved_at: Option<DateTime<Utc>>,
}

/// GET /api/admin/refunds
///
/// Returns all resolved `refund_buyer` disputes whose Lightning refund is stuck
/// (`manual_required` or `failed`). These require manual admin intervention —
/// either a direct LN payment or an M-Pesa reversal.
pub async fn list_stuck_refunds(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<Json<Vec<StuckRefund>>> {
    if claims.role != Role::Admin {
        return Err(AppError::Forbidden("Admin access required".into()));
    }

    #[derive(FromRow)]
    struct StuckRow {
        order_id: Uuid,
        product_title: String,
        buyer_name: String,
        seller_name: String,
        total_kes: Decimal,
        total_sats: Option<i64>,
        payment_method: Option<String>,
        refund_status: String,
        refund_notes: Option<String>,
        dispute_resolved_at: Option<DateTime<Utc>>,
    }

    // Use a LATERAL join to get the most recent settled payment for each order,
    // then filter by refund_status. We only surface rows that need manual action.
    let rows: Vec<StuckRow> = sqlx::query_as(
        "SELECT
             o.id                AS order_id,
             prod.title          AS product_title,
             bf.name             AS buyer_name,
             sf.name             AS seller_name,
             o.total_kes,
             o.total_sats,
             o.payment_method,
             pay.refund_status,
             pay.refund_notes,
             o.dispute_resolved_at
         FROM orders o
         JOIN farmers bf  ON bf.id  = o.buyer_id
         JOIN farmers sf  ON sf.id  = o.seller_id
         JOIN products prod ON prod.id = o.product_id
         JOIN LATERAL (
             SELECT refund_status, refund_notes
             FROM   payments
             WHERE  order_id = o.id
             ORDER  BY created_at DESC
             LIMIT  1
         ) pay ON true
         WHERE o.status             = 'cancelled'
           AND o.dispute_resolution = 'refund_buyer'
           AND pay.refund_status    IN ('manual_required', 'failed')
         ORDER BY o.dispute_resolved_at DESC NULLS LAST
         LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;

    let stuck = rows
        .into_iter()
        .map(|r| StuckRefund {
            order_id: r.order_id,
            product_title: r.product_title,
            buyer_name: r.buyer_name,
            seller_name: r.seller_name,
            total_kes: r.total_kes,
            total_sats: r.total_sats,
            payment_method: r.payment_method,
            refund_status: r.refund_status,
            refund_notes: r.refund_notes,
            dispute_resolved_at: r.dispute_resolved_at,
        })
        .collect();

    Ok(Json(stuck))
}
