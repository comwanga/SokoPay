use crate::auth::jwt::Claims;
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

const MAX_REVIEW_LEN: usize = 1000;

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RatingRequest {
    pub order_id: Uuid,
    pub rating: i16,
    pub review: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RatingResponse {
    pub id: Uuid,
    pub rating: i16,
    pub review: Option<String>,
    pub buyer_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct RatingSummary {
    pub avg_rating: f64,
    pub rating_count: i64,
    pub ratings: Vec<RatingResponse>,
}

#[derive(Debug, FromRow)]
struct RatingRow {
    id: Uuid,
    rating: i16,
    review: Option<String>,
    buyer_name: String,
    created_at: DateTime<Utc>,
}

impl From<RatingRow> for RatingResponse {
    fn from(r: RatingRow) -> Self {
        RatingResponse {
            id: r.id,
            rating: r.rating,
            review: r.review,
            buyer_name: r.buyer_name,
            created_at: r.created_at,
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn validate_rating_request(body: &RatingRequest) -> AppResult<()> {
    if body.rating < 1 || body.rating > 5 {
        return Err(AppError::BadRequest(
            "rating must be between 1 and 5".into(),
        ));
    }
    if let Some(ref review) = body.review {
        if review.len() > MAX_REVIEW_LEN {
            return Err(AppError::BadRequest(format!(
                "review exceeds {} characters",
                MAX_REVIEW_LEN
            )));
        }
    }
    Ok(())
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/products/:id/ratings
pub async fn rate_product(
    State(state): State<SharedState>,
    claims: Claims,
    Path(product_id): Path<Uuid>,
    Json(body): Json<RatingRequest>,
) -> AppResult<(StatusCode, Json<RatingResponse>)> {
    let buyer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user to rate products".into()))?;

    validate_rating_request(&body)?;

    // Verify the provided order_id is a real confirmed order by this buyer for
    // this product. We don't just check "any confirmed order exists" — we verify
    // the exact order_id the client claims, preventing shill ratings via fake IDs.
    let order_verified: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM orders
         WHERE id = $1 AND product_id = $2 AND buyer_id = $3 AND status = 'confirmed'",
    )
    .bind(body.order_id)
    .bind(product_id)
    .bind(buyer_id)
    .fetch_optional(&state.db)
    .await?;

    if order_verified.is_none() {
        return Err(AppError::Forbidden(
            "You can only rate products from your own confirmed orders".into(),
        ));
    }

    // Upsert: insert or update on conflict (product_id, buyer_id)
    let row: RatingRow = sqlx::query_as(
        "INSERT INTO product_ratings (product_id, buyer_id, order_id, rating, review)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (product_id, buyer_id) DO UPDATE
             SET rating = EXCLUDED.rating,
                 review = EXCLUDED.review,
                 order_id = EXCLUDED.order_id
         RETURNING id, rating, review,
             (SELECT name FROM farmers WHERE id = $2) AS buyer_name,
             created_at",
    )
    .bind(product_id)
    .bind(buyer_id)
    .bind(body.order_id)
    .bind(body.rating)
    .bind(body.review.as_deref())
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(row.into())))
}

/// GET /api/products/:id/ratings
pub async fn get_product_ratings(
    State(state): State<SharedState>,
    Path(product_id): Path<Uuid>,
) -> AppResult<Json<RatingSummary>> {
    #[derive(FromRow)]
    struct AggRow {
        avg_rating: f64,
        rating_count: i64,
    }
    let agg: AggRow = sqlx::query_as(
        "SELECT COALESCE(AVG(rating)::float8, 0.0) AS avg_rating,
                COUNT(*) AS rating_count
         FROM product_ratings
         WHERE product_id = $1",
    )
    .bind(product_id)
    .fetch_one(&state.db)
    .await?;

    let rows: Vec<RatingRow> = sqlx::query_as(
        "SELECT pr.id, pr.rating, pr.review, f.name AS buyer_name, pr.created_at
         FROM product_ratings pr
         JOIN farmers f ON f.id = pr.buyer_id
         WHERE pr.product_id = $1
         ORDER BY pr.created_at DESC
         LIMIT 10",
    )
    .bind(product_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(RatingSummary {
        avg_rating: agg.avg_rating,
        rating_count: agg.rating_count,
        ratings: rows.into_iter().map(Into::into).collect(),
    }))
}

/// POST /api/farmers/:id/ratings
pub async fn rate_seller(
    State(state): State<SharedState>,
    claims: Claims,
    Path(seller_id): Path<Uuid>,
    Json(body): Json<RatingRequest>,
) -> AppResult<(StatusCode, Json<RatingResponse>)> {
    let buyer_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user to rate sellers".into()))?;

    validate_rating_request(&body)?;

    if buyer_id == seller_id {
        return Err(AppError::BadRequest("You cannot rate yourself".into()));
    }

    // Verify the provided order_id is a real confirmed order by this buyer with
    // this seller. Exact-match on order_id prevents spoofing with arbitrary UUIDs.
    let order_verified: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM orders
         WHERE id = $1 AND seller_id = $2 AND buyer_id = $3 AND status = 'confirmed'",
    )
    .bind(body.order_id)
    .bind(seller_id)
    .bind(buyer_id)
    .fetch_optional(&state.db)
    .await?;

    if order_verified.is_none() {
        return Err(AppError::Forbidden(
            "You can only rate sellers from your own confirmed orders".into(),
        ));
    }

    // Upsert on conflict (seller_id, buyer_id)
    let row: RatingRow = sqlx::query_as(
        "INSERT INTO seller_ratings (seller_id, buyer_id, order_id, rating, review)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (seller_id, buyer_id) DO UPDATE
             SET rating = EXCLUDED.rating,
                 review = EXCLUDED.review,
                 order_id = EXCLUDED.order_id
         RETURNING id, rating, review,
             (SELECT name FROM farmers WHERE id = $2) AS buyer_name,
             created_at",
    )
    .bind(seller_id)
    .bind(buyer_id)
    .bind(body.order_id)
    .bind(body.rating)
    .bind(body.review.as_deref())
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(row.into())))
}

/// GET /api/farmers/:id/ratings
pub async fn get_seller_ratings(
    State(state): State<SharedState>,
    Path(seller_id): Path<Uuid>,
) -> AppResult<Json<RatingSummary>> {
    #[derive(FromRow)]
    struct AggRow {
        avg_rating: f64,
        rating_count: i64,
    }
    let agg: AggRow = sqlx::query_as(
        "SELECT COALESCE(AVG(rating)::float8, 0.0) AS avg_rating,
                COUNT(*) AS rating_count
         FROM seller_ratings
         WHERE seller_id = $1",
    )
    .bind(seller_id)
    .fetch_one(&state.db)
    .await?;

    let rows: Vec<RatingRow> = sqlx::query_as(
        "SELECT sr.id, sr.rating, sr.review, f.name AS buyer_name, sr.created_at
         FROM seller_ratings sr
         JOIN farmers f ON f.id = sr.buyer_id
         WHERE sr.seller_id = $1
         ORDER BY sr.created_at DESC
         LIMIT 10",
    )
    .bind(seller_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(RatingSummary {
        avg_rating: agg.avg_rating,
        rating_count: agg.rating_count,
        ratings: rows.into_iter().map(Into::into).collect(),
    }))
}
