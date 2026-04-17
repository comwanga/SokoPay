//! Public seller storefront — no authentication required.
//!
//! GET /api/storefront/:id
//!
//! Returns a seller's public profile, their active products, and rating summary.
//! This is the page buyers land on when they tap a seller's name anywhere in the app.
//! Cached-friendly: all data is read-only and changes infrequently.

use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use axum::{extract::{Path, State}, Json};
use chrono::DateTime;
use chrono::Utc;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct StorefrontResponse {
    pub seller: SellerProfile,
    pub products: Vec<StorefrontProduct>,
    pub rating_summary: RatingSummary,
}

#[derive(Debug, Serialize, FromRow)]
pub struct SellerProfile {
    pub id: Uuid,
    pub name: String,
    pub location_name: Option<String>,
    pub member_since: DateTime<Utc>,
    pub product_count: i64,
    pub confirmed_order_count: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct StorefrontProduct {
    pub id: Uuid,
    pub title: String,
    pub price_kes: Decimal,
    pub unit: String,
    pub quantity_avail: Decimal,
    pub category: String,
    pub location_name: String,
    pub avg_rating: Option<f64>,
    pub rating_count: i64,
    pub primary_image_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct RecentReview {
    pub rating: i16,
    pub review: Option<String>,
    pub buyer_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct RatingSummary {
    pub avg_rating: f64,
    pub rating_count: i64,
    pub recent_reviews: Vec<RecentReview>,
}

// ── Handler ───────────────────────────────────────────────────────────────────

/// GET /api/storefront/:id
///
/// Public profile for a seller. Returns their profile, active listings, and
/// ratings. No authentication required — this is a discovery / trust page.
pub async fn get_storefront(
    State(state): State<SharedState>,
    Path(seller_id): Path<Uuid>,
) -> AppResult<Json<StorefrontResponse>> {
    // ── Seller profile ────────────────────────────────────────────────────────
    let seller: Option<SellerProfile> = sqlx::query_as(
        "SELECT
             f.id, f.name, f.location_name, f.created_at AS member_since,
             (SELECT COUNT(*) FROM products WHERE seller_id = f.id
              AND status = 'active')::bigint AS product_count,
             (SELECT COUNT(*) FROM orders WHERE seller_id = f.id
              AND status = 'confirmed')::bigint AS confirmed_order_count
         FROM farmers f
         WHERE f.id = $1 AND f.deleted_at IS NULL",
    )
    .bind(seller_id)
    .fetch_optional(&state.db)
    .await?;

    let seller = seller
        .ok_or_else(|| AppError::NotFound(format!("Seller {} not found", seller_id)))?;

    // ── Active products ────────────────────────────────────────────────────────
    let products: Vec<StorefrontProduct> = sqlx::query_as(
        "SELECT
             p.id, p.title, p.price_kes, p.unit, p.quantity_avail,
             p.category, p.location_name, p.created_at,
             COALESCE(pr.avg_rating, NULL)  AS avg_rating,
             COALESCE(pr.rating_count, 0)   AS rating_count,
             (SELECT url FROM product_images
              WHERE product_id = p.id AND is_primary = TRUE
              ORDER BY sort_order LIMIT 1)  AS primary_image_url
         FROM products p
         LEFT JOIN (
             SELECT product_id,
                    AVG(rating)::float8 AS avg_rating,
                    COUNT(*) AS rating_count
             FROM product_ratings GROUP BY product_id
         ) pr ON pr.product_id = p.id
         WHERE p.seller_id = $1 AND p.status = 'active'
         ORDER BY p.created_at DESC
         LIMIT 50",
    )
    .bind(seller_id)
    .fetch_all(&state.db)
    .await?;

    // ── Rating summary ─────────────────────────────────────────────────────────
    #[derive(FromRow)]
    struct AggRow {
        avg_rating: f64,
        rating_count: i64,
    }

    let agg: AggRow = sqlx::query_as(
        "SELECT COALESCE(AVG(rating)::float8, 0.0) AS avg_rating,
                COUNT(*) AS rating_count
         FROM seller_ratings WHERE seller_id = $1",
    )
    .bind(seller_id)
    .fetch_one(&state.db)
    .await?;

    let recent_reviews: Vec<RecentReview> = sqlx::query_as(
        "SELECT sr.rating, sr.review, f.name AS buyer_name, sr.created_at
         FROM seller_ratings sr
         JOIN farmers f ON f.id = sr.buyer_id
         WHERE sr.seller_id = $1
         ORDER BY sr.created_at DESC
         LIMIT 5",
    )
    .bind(seller_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(StorefrontResponse {
        seller,
        products,
        rating_summary: RatingSummary {
            avg_rating: agg.avg_rating,
            rating_count: agg.rating_count,
            recent_reviews,
        },
    }))
}
