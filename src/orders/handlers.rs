use crate::auth::jwt::{Claims, Role};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::state::SharedState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

const MAX_NOTES_LEN: usize = 500;
const MAX_LOCATION_LEN: usize = 200;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct Order {
    pub id: Uuid,
    pub product_id: Uuid,
    pub product_title: String,
    pub seller_id: Uuid,
    pub seller_name: String,
    pub buyer_id: Uuid,
    pub buyer_name: String,
    pub quantity: Decimal,
    pub unit: String,
    pub unit_price_kes: Decimal,
    pub total_kes: Decimal,
    pub total_sats: Option<i64>,
    pub buyer_location_name: String,
    pub distance_km: Option<f64>,
    pub estimated_delivery_date: Option<NaiveDate>,
    pub seller_delivery_date: Option<NaiveDate>,
    pub delivery_notes: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct OrderRow {
    id: Uuid,
    product_id: Uuid,
    product_title: String,
    seller_id: Uuid,
    seller_name: String,
    buyer_id: Uuid,
    buyer_name: String,
    quantity: Decimal,
    unit: String,
    unit_price_kes: Decimal,
    total_kes: Decimal,
    total_sats: Option<i64>,
    buyer_location_name: String,
    distance_km: Option<f64>,
    estimated_delivery_date: Option<NaiveDate>,
    seller_delivery_date: Option<NaiveDate>,
    delivery_notes: Option<String>,
    status: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<OrderRow> for Order {
    fn from(r: OrderRow) -> Self {
        Order {
            id: r.id,
            product_id: r.product_id,
            product_title: r.product_title,
            seller_id: r.seller_id,
            seller_name: r.seller_name,
            buyer_id: r.buyer_id,
            buyer_name: r.buyer_name,
            quantity: r.quantity,
            unit: r.unit,
            unit_price_kes: r.unit_price_kes,
            total_kes: r.total_kes,
            total_sats: r.total_sats,
            buyer_location_name: r.buyer_location_name,
            distance_km: r.distance_km,
            estimated_delivery_date: r.estimated_delivery_date,
            seller_delivery_date: r.seller_delivery_date,
            delivery_notes: r.delivery_notes,
            status: r.status,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateOrderRequest {
    pub product_id: Uuid,
    pub quantity: Decimal,
    pub buyer_lat: Option<f64>,
    pub buyer_lng: Option<f64>,
    pub buyer_location_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOrderStatusRequest {
    pub status: String,
    /// Seller-confirmed delivery date, "YYYY-MM-DD". Seller only.
    pub delivery_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListOrdersQuery {
    /// "buyer" to see purchases, "seller" to see sales, omit for both
    pub role: Option<String>,
}

// ── Delivery estimation ───────────────────────────────────────────────────────

fn haversine_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    const R: f64 = 6371.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlng = (lng2 - lng1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlng / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

fn estimate_delivery_days(km: f64) -> i64 {
    if km <= 50.0 {
        1
    } else if km <= 200.0 {
        2
    } else if km <= 500.0 {
        4
    } else {
        7
    }
}

// ── State machine ─────────────────────────────────────────────────────────────

fn can_transition(from: &str, to: &str, actor_is_seller: bool) -> bool {
    match (from, to) {
        // Seller advances fulfilment
        ("paid", "processing") if actor_is_seller => true,
        ("processing", "in_transit") if actor_is_seller => true,
        ("in_transit", "delivered") if actor_is_seller => true,
        // Buyer confirms or disputes
        ("delivered", "confirmed") if !actor_is_seller => true,
        ("delivered", "disputed") if !actor_is_seller => true,
        // Either party can cancel pending orders
        ("pending_payment", "cancelled") => true,
        // Buyer can cancel before seller starts processing
        ("paid", "cancelled") if !actor_is_seller => true,
        _ => false,
    }
}

// ── SELECT fragment ───────────────────────────────────────────────────────────

const ORDER_SELECT: &str = r#"
    SELECT
        o.id, o.product_id, p.title AS product_title,
        o.seller_id, sf.name AS seller_name,
        o.buyer_id, bf.name AS buyer_name,
        o.quantity, p.unit, o.unit_price_kes, o.total_kes, o.total_sats,
        o.buyer_location_name, o.distance_km,
        o.estimated_delivery_date, o.seller_delivery_date, o.delivery_notes,
        o.status, o.created_at, o.updated_at
    FROM orders o
    JOIN products p  ON p.id = o.product_id
    JOIN farmers sf ON sf.id = o.seller_id
    JOIN farmers bf ON bf.id = o.buyer_id
"#;

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/orders
pub async fn create_order(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<CreateOrderRequest>,
) -> AppResult<(StatusCode, Json<Order>)> {
    let buyer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user to place orders".into()))?;

    if body.quantity <= Decimal::ZERO {
        return Err(AppError::BadRequest("quantity must be positive".into()));
    }

    // Fetch product
    #[derive(FromRow)]
    struct ProductInfo {
        seller_id: Uuid,
        price_kes: Decimal,
        quantity_avail: Decimal,
        status: String,
        location_lat: Option<f64>,
        location_lng: Option<f64>,
    }
    let product: Option<ProductInfo> = sqlx::query_as(
        "SELECT seller_id, price_kes, quantity_avail, status, location_lat, location_lng
         FROM products WHERE id = $1",
    )
    .bind(body.product_id)
    .fetch_optional(&state.db)
    .await?;

    let product = product
        .ok_or_else(|| AppError::NotFound(format!("Product {} not found", body.product_id)))?;

    if product.status != "active" {
        return Err(AppError::BadRequest(
            "This product is not available for purchase".into(),
        ));
    }
    if product.seller_id == buyer_id {
        return Err(AppError::BadRequest(
            "You cannot purchase your own listing".into(),
        ));
    }
    if body.quantity > product.quantity_avail {
        return Err(AppError::BadRequest(format!(
            "Only {} available",
            product.quantity_avail
        )));
    }

    let unit_price_kes = product.price_kes;
    let total_kes = (unit_price_kes * body.quantity).round_dp(2);

    // Delivery estimate
    let (distance_km, estimated_delivery_date) = match (
        body.buyer_lat,
        body.buyer_lng,
        product.location_lat,
        product.location_lng,
    ) {
        (Some(blat), Some(blng), Some(slat), Some(slng)) => {
            let km = haversine_km(slat, slng, blat, blng);
            let days = estimate_delivery_days(km);
            let date = (Utc::now() + Duration::days(days)).date_naive();
            (Some(km), Some(date))
        }
        _ => (None, None),
    };

    let buyer_location_name = body
        .buyer_location_name
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if buyer_location_name.len() > MAX_LOCATION_LEN {
        return Err(AppError::BadRequest(format!(
            "buyer_location_name exceeds {} characters",
            MAX_LOCATION_LEN
        )));
    }

    // Atomically decrement quantity and create order
    let mut tx = state.db.begin().await?;

    let rows_affected = sqlx::query(
        "UPDATE products SET quantity_avail = quantity_avail - $2
         WHERE id = $1 AND quantity_avail >= $2 AND status = 'active'",
    )
    .bind(body.product_id)
    .bind(body.quantity)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        tx.rollback().await?;
        return Err(AppError::Conflict(
            "Insufficient stock or product no longer available".into(),
        ));
    }

    let order_id: Uuid = sqlx::query_scalar(
        "INSERT INTO orders
             (product_id, seller_id, buyer_id, quantity, unit_price_kes, total_kes,
              buyer_lat, buyer_lng, buyer_location_name, distance_km, estimated_delivery_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id",
    )
    .bind(body.product_id)
    .bind(product.seller_id)
    .bind(buyer_id)
    .bind(body.quantity)
    .bind(unit_price_kes)
    .bind(total_kes)
    .bind(body.buyer_lat)
    .bind(body.buyer_lng)
    .bind(&buyer_location_name)
    .bind(distance_km)
    .bind(estimated_delivery_date)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    events::record_order_event(
        &state.db,
        order_id,
        Some(buyer_id),
        "order_created",
        None,
        serde_json::json!({
            "product_id": body.product_id,
            "quantity": body.quantity,
            "total_kes": total_kes,
            "distance_km": distance_km,
        }),
    )
    .await
    .ok();

    let order: OrderRow = sqlx::query_as(&format!("{} WHERE o.id = $1", ORDER_SELECT))
        .bind(order_id)
        .fetch_one(&state.db)
        .await?;

    Ok((StatusCode::CREATED, Json(order.into())))
}

/// GET /api/orders
pub async fn list_orders(
    State(state): State<SharedState>,
    claims: Claims,
    Query(q): Query<ListOrdersQuery>,
) -> AppResult<Json<Vec<Order>>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let rows: Vec<OrderRow> = match q.role.as_deref() {
        Some("seller") => {
            sqlx::query_as(&format!(
                "{} WHERE o.seller_id = $1 ORDER BY o.created_at DESC LIMIT 200",
                ORDER_SELECT
            ))
            .bind(user_id)
            .fetch_all(&state.db)
            .await?
        }

        Some("buyer") => {
            sqlx::query_as(&format!(
                "{} WHERE o.buyer_id = $1 ORDER BY o.created_at DESC LIMIT 200",
                ORDER_SELECT
            ))
            .bind(user_id)
            .fetch_all(&state.db)
            .await?
        }

        _ => {
            sqlx::query_as(&format!(
                "{} WHERE o.seller_id = $1 OR o.buyer_id = $1 ORDER BY o.created_at DESC LIMIT 200",
                ORDER_SELECT
            ))
            .bind(user_id)
            .fetch_all(&state.db)
            .await?
        }
    };

    Ok(Json(rows.into_iter().map(Into::into).collect()))
}

/// GET /api/orders/:id
pub async fn get_order(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Order>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let order: Option<OrderRow> = sqlx::query_as(&format!("{} WHERE o.id = $1", ORDER_SELECT))
        .bind(id)
        .fetch_optional(&state.db)
        .await?;

    let order = order.ok_or_else(|| AppError::NotFound(format!("Order {} not found", id)))?;

    // Only seller, buyer, or admin can view the order
    if claims.role != Role::Admin && order.seller_id != user_id && order.buyer_id != user_id {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    Ok(Json(order.into()))
}

/// PATCH /api/orders/:id/status
pub async fn update_order_status(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateOrderStatusRequest>,
) -> AppResult<Json<Order>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    if let Some(ref notes) = body.notes {
        if notes.len() > MAX_NOTES_LEN {
            return Err(AppError::BadRequest(format!(
                "notes exceeds {} characters",
                MAX_NOTES_LEN
            )));
        }
    }

    #[derive(FromRow)]
    struct OrderMeta {
        seller_id: Uuid,
        buyer_id: Uuid,
        status: String,
    }
    let meta: Option<OrderMeta> =
        sqlx::query_as("SELECT seller_id, buyer_id, status FROM orders WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    let meta = meta.ok_or_else(|| AppError::NotFound(format!("Order {} not found", id)))?;

    if meta.seller_id != user_id && meta.buyer_id != user_id && claims.role != Role::Admin {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    let actor_is_seller = meta.seller_id == user_id;

    if !can_transition(&meta.status, &body.status, actor_is_seller) {
        return Err(AppError::BadRequest(format!(
            "Cannot transition from '{}' to '{}'",
            meta.status, body.status
        )));
    }

    // Parse optional delivery date
    let delivery_date: Option<NaiveDate> = if let Some(ref ds) = body.delivery_date {
        Some(
            NaiveDate::parse_from_str(ds, "%Y-%m-%d")
                .map_err(|_| AppError::BadRequest("delivery_date must be YYYY-MM-DD".into()))?,
        )
    } else {
        None
    };

    sqlx::query(
        "UPDATE orders SET
            status               = $2,
            seller_delivery_date = COALESCE($3, seller_delivery_date),
            delivery_notes       = COALESCE($4, delivery_notes)
         WHERE id = $1",
    )
    .bind(id)
    .bind(&body.status)
    .bind(delivery_date)
    .bind(&body.notes)
    .execute(&state.db)
    .await?;

    events::record_order_event(
        &state.db,
        id,
        Some(user_id),
        &body.status,
        body.notes.as_deref(),
        serde_json::json!({ "delivery_date": body.delivery_date }),
    )
    .await
    .ok();

    let order: OrderRow = sqlx::query_as(&format!("{} WHERE o.id = $1", ORDER_SELECT))
        .bind(id)
        .fetch_one(&state.db)
        .await?;

    Ok(Json(order.into()))
}

/// DELETE /api/orders/:id  (cancel pending_payment orders only)
pub async fn cancel_order(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    #[derive(FromRow)]
    struct OrderMeta {
        product_id: Uuid,
        seller_id: Uuid,
        buyer_id: Uuid,
        quantity: Decimal,
        status: String,
    }
    let meta: Option<OrderMeta> = sqlx::query_as(
        "SELECT product_id, seller_id, buyer_id, quantity, status FROM orders WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    let meta = meta.ok_or_else(|| AppError::NotFound(format!("Order {} not found", id)))?;

    if meta.seller_id != user_id && meta.buyer_id != user_id && claims.role != Role::Admin {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    if meta.status != "pending_payment" {
        return Err(AppError::BadRequest(format!(
            "Cannot cancel an order with status '{}'",
            meta.status
        )));
    }

    // Restore product quantity and cancel order atomically
    let mut tx = state.db.begin().await?;

    sqlx::query("UPDATE orders SET status = 'cancelled' WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE products SET quantity_avail = quantity_avail + $2 WHERE id = $1")
        .bind(meta.product_id)
        .bind(meta.quantity)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    events::record_order_event(
        &state.db,
        id,
        Some(user_id),
        "cancelled",
        None,
        serde_json::json!({}),
    )
    .await
    .ok();

    Ok(Json(serde_json::json!({ "cancelled": true })))
}

// ── Unit tests (state machine) ────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::can_transition;

    #[test]
    fn test_seller_advances_paid_to_processing() {
        assert!(can_transition("paid", "processing", true));
    }

    #[test]
    fn test_buyer_cannot_advance_paid_to_processing() {
        assert!(!can_transition("paid", "processing", false));
    }

    #[test]
    fn test_seller_marks_in_transit() {
        assert!(can_transition("processing", "in_transit", true));
    }

    #[test]
    fn test_seller_marks_delivered() {
        assert!(can_transition("in_transit", "delivered", true));
    }

    #[test]
    fn test_buyer_confirms_delivered() {
        assert!(can_transition("delivered", "confirmed", false));
    }

    #[test]
    fn test_seller_cannot_confirm_delivered() {
        assert!(!can_transition("delivered", "confirmed", true));
    }

    #[test]
    fn test_buyer_disputes_delivered() {
        assert!(can_transition("delivered", "disputed", false));
    }

    #[test]
    fn test_seller_cannot_dispute_delivered() {
        assert!(!can_transition("delivered", "disputed", true));
    }

    #[test]
    fn test_either_can_cancel_pending_payment() {
        assert!(can_transition("pending_payment", "cancelled", true));
        assert!(can_transition("pending_payment", "cancelled", false));
    }

    #[test]
    fn test_buyer_can_cancel_paid_before_processing() {
        assert!(can_transition("paid", "cancelled", false));
    }

    #[test]
    fn test_seller_cannot_cancel_paid() {
        assert!(!can_transition("paid", "cancelled", true));
    }

    #[test]
    fn test_no_skipping_states() {
        // Can't jump from pending_payment directly to processing
        assert!(!can_transition("pending_payment", "processing", true));
        // Can't go backwards from delivered to processing
        assert!(!can_transition("delivered", "processing", true));
    }
}
