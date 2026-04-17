//! Market price index.
//!
//! Aggregates current active listings to provide category-level price
//! statistics.  Useful for:
//!   - Buyers comparing whether they're paying a fair price.
//!   - Sellers benchmarking against the market before listing.
//!   - Platform analytics / press releases.
//!
//! The query runs on-demand (no materialised view) — active product counts
//! are typically small enough that this is fast.  If the table grows large,
//! a MATERIALIZED VIEW refreshed every 15 minutes is the right next step.
//!
//! Endpoint: GET /api/price-index

use crate::error::AppResult;
use crate::state::SharedState;
use axum::{extract::State, Json};
use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CategoryPriceStats {
    pub category: String,
    pub product_count: i64,
    pub avg_price_kes: f64,
    pub min_price_kes: f64,
    pub max_price_kes: f64,
    pub median_price_kes: f64,
}

/// GET /api/price-index
///
/// Returns price statistics per product category.
/// Only active listings are included; categories with fewer than 2 products
/// are excluded to avoid exposing single-seller pricing information.
pub async fn get_price_index(
    State(state): State<SharedState>,
) -> AppResult<Json<Vec<CategoryPriceStats>>> {
    let rows: Vec<CategoryPriceStats> = sqlx::query_as(
        "SELECT
             category,
             COUNT(*)::bigint                                                    AS product_count,
             AVG(price_kes)::float8                                             AS avg_price_kes,
             MIN(price_kes)::float8                                             AS min_price_kes,
             MAX(price_kes)::float8                                             AS max_price_kes,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_kes)::float8    AS median_price_kes
         FROM products
         WHERE status = 'active' AND category <> ''
         GROUP BY category
         HAVING COUNT(*) >= 2
         ORDER BY product_count DESC, category ASC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}
