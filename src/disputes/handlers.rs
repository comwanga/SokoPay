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

    let meta =
        meta.ok_or_else(|| AppError::NotFound(format!("Order {} not found", order_id)))?;

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

    events::record_order_event(
        &state.db,
        order_id,
        Some(user_id),
        "disputed",
        None,
        serde_json::json!({ "reason": reason }),
    )
    .await
    .ok();

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
        return Err(AppError::Forbidden(
            "Admin access required".into(),
        ));
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
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
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
        "refund_buyer" => "cancelled",  // seller ships nothing; buyer notified separately
        "release_seller" => "confirmed", // seller fulfilled; funds already in seller wallet
        "split" => "confirmed",          // partial; admin handles externally
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

    events::record_order_event(
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
    .ok();

    tracing::info!(
        order_id = %order_id,
        resolution = %body.resolution,
        "Dispute resolved by admin"
    );

    Ok(Json(serde_json::json!({
        "resolved": true,
        "order_id": order_id,
        "resolution": body.resolution,
        "final_status": final_status,
    })))
}
