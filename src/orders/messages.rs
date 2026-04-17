//! Buyer ↔ seller order messaging.
//!
//! Routes (mounted under /api):
//!   POST /orders/:id/messages   — send a message to the other party
//!   GET  /orders/:id/messages   — fetch the full thread (oldest first)
//!
//! Access: only the buyer, the seller, and admins can read or send messages.
//! Messages are append-only for audit and dispute integrity.

use crate::auth::jwt::{Claims, Role};
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

const MAX_BODY_LEN: usize = 2000;

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub body: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct OrderMessage {
    pub id: Uuid,
    pub order_id: Uuid,
    pub sender_id: Uuid,
    pub sender_name: String,
    /// "buyer" | "seller"
    pub sender_role: String,
    pub body: String,
    pub sent_at: DateTime<Utc>,
}

// ── Access guard ──────────────────────────────────────────────────────────────

#[derive(FromRow)]
struct OrderParties {
    buyer_id: Uuid,
    seller_id: Uuid,
}

async fn load_parties_and_check_access(
    state: &SharedState,
    order_id: Uuid,
    user_id: Uuid,
    role: &Role,
) -> AppResult<OrderParties> {
    let parties: Option<OrderParties> =
        sqlx::query_as("SELECT buyer_id, seller_id FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&state.db)
            .await?;

    let parties =
        parties.ok_or_else(|| AppError::NotFound(format!("Order {} not found", order_id)))?;

    if *role != Role::Admin && parties.buyer_id != user_id && parties.seller_id != user_id {
        return Err(AppError::Forbidden(
            "Only parties to this order can access messages".into(),
        ));
    }

    Ok(parties)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/orders/:id/messages
pub async fn send_message(
    State(state): State<SharedState>,
    claims: Claims,
    Path(order_id): Path<Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> AppResult<(StatusCode, Json<OrderMessage>)> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let text = body.body.trim().to_string();
    if text.is_empty() {
        return Err(AppError::BadRequest("message body is required".into()));
    }
    if text.len() > MAX_BODY_LEN {
        return Err(AppError::BadRequest(format!(
            "message exceeds {} characters",
            MAX_BODY_LEN
        )));
    }

    let parties = load_parties_and_check_access(&state, order_id, user_id, &claims.role).await?;

    let sender_role = if user_id == parties.seller_id {
        "seller"
    } else {
        "buyer"
    };

    let msg: OrderMessage = sqlx::query_as(
        "INSERT INTO order_messages (order_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING
             id, order_id, sender_id,
             (SELECT name FROM farmers WHERE id = $2) AS sender_name,
             $4::text AS sender_role,
             body, sent_at",
    )
    .bind(order_id)
    .bind(user_id)
    .bind(&text)
    .bind(sender_role)
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(msg)))
}

/// GET /api/orders/:id/messages
pub async fn get_messages(
    State(state): State<SharedState>,
    claims: Claims,
    Path(order_id): Path<Uuid>,
) -> AppResult<Json<Vec<OrderMessage>>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let parties = load_parties_and_check_access(&state, order_id, user_id, &claims.role).await?;

    let messages: Vec<OrderMessage> = sqlx::query_as(
        "SELECT
             m.id, m.order_id, m.sender_id,
             f.name AS sender_name,
             CASE WHEN m.sender_id = $2 THEN 'seller' ELSE 'buyer' END AS sender_role,
             m.body, m.sent_at
         FROM order_messages m
         JOIN farmers f ON f.id = m.sender_id
         WHERE m.order_id = $1
         ORDER BY m.sent_at ASC
         LIMIT 500",
    )
    .bind(order_id)
    .bind(parties.seller_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(messages))
}
