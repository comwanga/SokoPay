use crate::auth::jwt::{Claims, Role};
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use anyhow::Result;
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

const MAX_NAME_LEN: usize = 200;
const MAX_PIN_LEN: usize = 10;
const MAX_LOCATION_LEN: usize = 200;
const MAX_LN_ADDRESS_LEN: usize = 300;

// ── Phone normalisation (kept here since M-Pesa module is removed) ────────────

pub fn normalize_phone(phone: &str) -> Result<String> {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    let normalized = if digits.starts_with("254") {
        digits
    } else if let Some(stripped) = digits.strip_prefix('0') {
        format!("254{}", stripped)
    } else if digits.starts_with('7') || digits.starts_with('1') {
        format!("254{}", digits)
    } else {
        return Err(anyhow::anyhow!("Invalid phone number: {}", phone));
    };
    if normalized.len() != 12 {
        return Err(anyhow::anyhow!(
            "Phone number must be 12 digits after normalisation, got: {}",
            normalized
        ));
    }
    Ok(normalized)
}

// ── Response / request types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct Farmer {
    pub id: Uuid,
    pub name: String,
    pub phone: Option<String>,
    pub nostr_pubkey: Option<String>,
    pub ln_address: Option<String>,
    pub location_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateFarmerRequest {
    pub name: String,
    pub phone: String,
    pub cooperative: Option<String>,
    pub pin: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateFarmerRequest {
    pub name: Option<String>,
    pub pin: Option<String>,
    pub ln_address: Option<String>,
    pub location_name: Option<String>,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// GET /api/farmers
pub async fn list_farmers(
    State(state): State<SharedState>,
    claims: Claims,
) -> AppResult<Json<Vec<Farmer>>> {
    match claims.role {
        Role::Admin | Role::Operator => {}
        _ => return Err(AppError::Forbidden("Admin or operator required".into())),
    }

    let farmers: Vec<Farmer> = sqlx::query_as(
        "SELECT id, name, phone, nostr_pubkey, ln_address, location_name, created_at
         FROM farmers ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(farmers))
}

/// POST /api/farmers  (admin creates a farmer with phone + PIN)
pub async fn create_farmer(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<CreateFarmerRequest>,
) -> AppResult<Json<Farmer>> {
    if claims.role != Role::Admin {
        return Err(AppError::Forbidden("Admin only".into()));
    }

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    if name.len() > MAX_NAME_LEN {
        return Err(AppError::BadRequest(format!(
            "name exceeds {} characters",
            MAX_NAME_LEN
        )));
    }
    if body.phone.trim().is_empty() {
        return Err(AppError::BadRequest("phone is required".into()));
    }

    let phone = normalize_phone(&body.phone).map_err(|e| AppError::BadRequest(e.to_string()))?;

    let pin_hash: Option<String> = if let Some(pin) = &body.pin {
        if pin.len() < 4 {
            return Err(AppError::BadRequest("PIN must be at least 4 digits".into()));
        }
        if pin.len() > MAX_PIN_LEN {
            return Err(AppError::BadRequest(format!(
                "PIN exceeds {} characters",
                MAX_PIN_LEN
            )));
        }
        Some(
            bcrypt::hash(pin, bcrypt::DEFAULT_COST)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt error: {}", e)))?,
        )
    } else {
        None
    };

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO farmers (name, phone, cooperative, pin_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(&name)
    .bind(&phone)
    .bind(body.cooperative.as_deref().unwrap_or("").trim())
    .bind(&pin_hash)
    .fetch_one(&state.db)
    .await?;

    let farmer: Farmer = sqlx::query_as(
        "SELECT id, name, phone, nostr_pubkey, ln_address, location_name, created_at
         FROM farmers WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(farmer))
}

/// GET /api/farmers/:id
pub async fn get_farmer(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Farmer>> {
    if claims.role == Role::Farmer && claims.farmer_id != Some(id) {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    let farmer: Option<Farmer> = sqlx::query_as(
        "SELECT id, name, phone, nostr_pubkey, ln_address, location_name, created_at
         FROM farmers WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;

    farmer
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("Farmer {} not found", id)))
}

/// PUT /api/farmers/:id
/// Admin can update any farmer. Farmers can update their own profile.
pub async fn update_farmer(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateFarmerRequest>,
) -> AppResult<Json<Farmer>> {
    // Farmers can only update their own profile; admin can update anyone
    if claims.role == Role::Farmer && claims.farmer_id != Some(id) {
        return Err(AppError::Forbidden(
            "You can only update your own profile".into(),
        ));
    }
    if claims.role == Role::Operator {
        return Err(AppError::Forbidden("Admin or farmer required".into()));
    }

    let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM farmers WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("Farmer {} not found", id)));
    }

    if let Some(ref name) = body.name {
        let n = name.trim();
        if n.is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
        if n.len() > MAX_NAME_LEN {
            return Err(AppError::BadRequest(format!(
                "name exceeds {} characters",
                MAX_NAME_LEN
            )));
        }
    }

    if let Some(ref pin) = body.pin {
        if pin.len() < 4 {
            return Err(AppError::BadRequest("PIN must be at least 4 digits".into()));
        }
        if pin.len() > MAX_PIN_LEN {
            return Err(AppError::BadRequest(format!(
                "PIN exceeds {} characters",
                MAX_PIN_LEN
            )));
        }
    }

    if let Some(ref ln) = body.ln_address {
        let ln = ln.trim();
        if !ln.is_empty() {
            if ln.len() > MAX_LN_ADDRESS_LEN {
                return Err(AppError::BadRequest(format!(
                    "ln_address exceeds {} characters",
                    MAX_LN_ADDRESS_LEN
                )));
            }
            // Basic format check: must contain exactly one '@'
            let at_count = ln.chars().filter(|&c| c == '@').count();
            if at_count != 1 {
                return Err(AppError::BadRequest(
                    "ln_address must be in user@domain format".into(),
                ));
            }
        }
    }

    if let Some(ref loc) = body.location_name {
        if loc.len() > MAX_LOCATION_LEN {
            return Err(AppError::BadRequest(format!(
                "location_name exceeds {} characters",
                MAX_LOCATION_LEN
            )));
        }
    }

    let pin_hash: Option<String> = if let Some(ref pin) = body.pin {
        Some(
            bcrypt::hash(pin, bcrypt::DEFAULT_COST)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt error: {}", e)))?,
        )
    } else {
        None
    };

    sqlx::query(
        "UPDATE farmers SET
            name          = COALESCE($2, name),
            pin_hash      = COALESCE($3, pin_hash),
            ln_address    = COALESCE($4, ln_address),
            location_name = COALESCE($5, location_name),
            location_lat  = COALESCE($6, location_lat),
            location_lng  = COALESCE($7, location_lng)
         WHERE id = $1",
    )
    .bind(id)
    .bind(body.name.as_deref().map(str::trim))
    .bind(&pin_hash)
    .bind(body.ln_address.as_deref().map(str::trim))
    .bind(body.location_name.as_deref().map(str::trim))
    .bind(body.location_lat)
    .bind(body.location_lng)
    .execute(&state.db)
    .await?;

    let farmer: Farmer = sqlx::query_as(
        "SELECT id, name, phone, nostr_pubkey, ln_address, location_name, created_at
         FROM farmers WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(farmer))
}

/// DELETE /api/farmers/:id  (admin only)
pub async fn delete_farmer(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    if claims.role != Role::Admin {
        return Err(AppError::Forbidden("Admin only".into()));
    }

    let result = sqlx::query("DELETE FROM farmers WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Farmer {} not found", id)));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ── Analytics ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ProductStat {
    pub product_id: Uuid,
    pub title: String,
    pub units_sold: Decimal,
    pub revenue_kes: Decimal,
    pub order_count: i64,
}

#[derive(Debug, Serialize)]
pub struct MonthlyRevenue {
    pub month: String,
    pub revenue_kes: Decimal,
    pub order_count: i64,
}

#[derive(Debug, Serialize)]
pub struct OrderSummary {
    pub id: Uuid,
    pub product_title: String,
    pub buyer_name: String,
    pub quantity: Decimal,
    pub unit: String,
    pub total_kes: Decimal,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct AnalyticsResponse {
    pub total_orders: i64,
    pub completed_orders: i64,
    pub pending_orders: i64,
    pub total_revenue_kes: Decimal,
    pub total_revenue_sats: i64,
    pub avg_order_value_kes: Decimal,
    pub top_products: Vec<ProductStat>,
    pub recent_orders: Vec<OrderSummary>,
    pub monthly_revenue: Vec<MonthlyRevenue>,
}

/// GET /api/farmers/:id/analytics
pub async fn get_farmer_analytics(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> AppResult<Json<AnalyticsResponse>> {
    // Only the farmer themselves or an admin can view analytics
    if claims.role == Role::Farmer && claims.farmer_id != Some(id) {
        return Err(AppError::Forbidden("Access denied".into()));
    }

    // Total / completed / pending counts
    let total_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE seller_id = $1 AND status NOT IN ('cancelled')",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    let completed_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE seller_id = $1 AND status = 'confirmed'",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    let pending_orders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE seller_id = $1 AND status IN ('pending_payment', 'paid', 'processing', 'in_transit', 'delivered')",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    // Revenue
    let total_revenue_kes: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_kes), 0) FROM orders WHERE seller_id = $1 AND status = 'confirmed'",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    let total_revenue_sats: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_sats), 0) FROM orders WHERE seller_id = $1 AND status = 'confirmed'",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    let avg_order_value_kes: Decimal = if completed_orders > 0 {
        (total_revenue_kes / Decimal::from(completed_orders)).round_dp(2)
    } else {
        Decimal::ZERO
    };

    // Top 5 products by revenue
    #[derive(FromRow)]
    struct ProductStatRow {
        product_id: Uuid,
        title: String,
        units_sold: Decimal,
        revenue_kes: Decimal,
        order_count: i64,
    }
    let top_product_rows: Vec<ProductStatRow> = sqlx::query_as(
        "SELECT o.product_id, p.title,
                COALESCE(SUM(o.quantity), 0) AS units_sold,
                COALESCE(SUM(o.total_kes), 0) AS revenue_kes,
                COUNT(*) AS order_count
         FROM orders o
         JOIN products p ON p.id = o.product_id
         WHERE o.seller_id = $1 AND o.status = 'confirmed'
         GROUP BY o.product_id, p.title
         ORDER BY revenue_kes DESC
         LIMIT 5",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let top_products = top_product_rows
        .into_iter()
        .map(|r| ProductStat {
            product_id: r.product_id,
            title: r.title,
            units_sold: r.units_sold,
            revenue_kes: r.revenue_kes,
            order_count: r.order_count,
        })
        .collect();

    // Last 10 orders
    #[derive(FromRow)]
    struct OrderSummaryRow {
        id: Uuid,
        product_title: String,
        buyer_name: String,
        quantity: Decimal,
        unit: String,
        total_kes: Decimal,
        status: String,
        created_at: DateTime<Utc>,
    }
    let recent_order_rows: Vec<OrderSummaryRow> = sqlx::query_as(
        "SELECT o.id, p.title AS product_title, f.name AS buyer_name,
                o.quantity, p.unit, o.total_kes, o.status, o.created_at
         FROM orders o
         JOIN products p ON p.id = o.product_id
         JOIN farmers f ON f.id = o.buyer_id
         WHERE o.seller_id = $1
         ORDER BY o.created_at DESC
         LIMIT 10",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let recent_orders = recent_order_rows
        .into_iter()
        .map(|r| OrderSummary {
            id: r.id,
            product_title: r.product_title,
            buyer_name: r.buyer_name,
            quantity: r.quantity,
            unit: r.unit,
            total_kes: r.total_kes,
            status: r.status,
            created_at: r.created_at,
        })
        .collect();

    // Monthly revenue — last 6 months
    #[derive(FromRow)]
    struct MonthlyRow {
        month: String,
        revenue_kes: Decimal,
        order_count: i64,
    }
    let monthly_rows: Vec<MonthlyRow> = sqlx::query_as(
        "SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                COALESCE(SUM(total_kes), 0) AS revenue_kes,
                COUNT(*) AS order_count
         FROM orders
         WHERE seller_id = $1
           AND status = 'confirmed'
           AND created_at >= NOW() - INTERVAL '6 months'
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY DATE_TRUNC('month', created_at) DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    let monthly_revenue = monthly_rows
        .into_iter()
        .map(|r| MonthlyRevenue {
            month: r.month,
            revenue_kes: r.revenue_kes,
            order_count: r.order_count,
        })
        .collect();

    Ok(Json(AnalyticsResponse {
        total_orders,
        completed_orders,
        pending_orders,
        total_revenue_kes,
        total_revenue_sats,
        avg_order_value_kes,
        top_products,
        recent_orders,
        monthly_revenue,
    }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::normalize_phone;

    #[test]
    fn test_normalize_safaricom_07xx() {
        assert_eq!(normalize_phone("0712345678").unwrap(), "254712345678");
    }

    #[test]
    fn test_normalize_safaricom_01xx() {
        assert_eq!(normalize_phone("0112345678").unwrap(), "254112345678");
    }

    #[test]
    fn test_normalize_already_254() {
        assert_eq!(normalize_phone("254712345678").unwrap(), "254712345678");
    }

    #[test]
    fn test_normalize_with_plus() {
        assert_eq!(normalize_phone("+254712345678").unwrap(), "254712345678");
    }

    #[test]
    fn test_normalize_bare_7xx() {
        assert_eq!(normalize_phone("712345678").unwrap(), "254712345678");
    }

    #[test]
    fn test_normalize_rejects_short() {
        assert!(normalize_phone("071234567").is_err());
    }
}
