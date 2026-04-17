use crate::auth::jwt::Claims;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use axum::{
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::HashMap;
use uuid::Uuid;

const MAX_TITLE_LEN: usize = 200;
const MAX_DESC_LEN: usize = 2000;
const MAX_UNIT_LEN: usize = 50;
const MAX_CATEGORY_LEN: usize = 100;
const MAX_LOCATION_LEN: usize = 200;
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024; // 5 MB
const MAX_IMAGES_PER_PRODUCT: i64 = 5;

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct ProductImage {
    pub id: Uuid,
    pub product_id: Uuid,
    pub url: String,
    pub is_primary: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct Product {
    pub id: Uuid,
    pub seller_id: Uuid,
    pub seller_name: String,
    pub title: String,
    pub description: String,
    pub price_kes: Decimal,
    pub unit: String,
    pub quantity_avail: Decimal,
    pub category: String,
    pub status: String,
    pub location_name: String,
    pub country_code: String,
    pub currency_code: String,
    pub ships_to: Vec<String>,
    pub is_global: bool,
    pub images: Vec<ProductImage>,
    pub avg_rating: Option<f64>,
    pub rating_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct ProductRow {
    id: Uuid,
    seller_id: Uuid,
    seller_name: String,
    title: String,
    description: String,
    price_kes: Decimal,
    unit: String,
    quantity_avail: Decimal,
    category: String,
    status: String,
    location_name: String,
    country_code: String,
    currency_code: String,
    ships_to: Vec<String>,
    is_global: bool,
    avg_rating: Option<f64>,
    rating_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

// ── Request types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateProductRequest {
    pub title: String,
    pub description: Option<String>,
    pub price_kes: Decimal,
    pub unit: Option<String>,
    pub quantity_avail: Decimal,
    pub category: Option<String>,
    pub location_name: Option<String>,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
    pub country_code: Option<String>,
    pub currency_code: Option<String>,
    pub ships_to: Option<Vec<String>>,
    pub is_global: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProductRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub price_kes: Option<Decimal>,
    pub unit: Option<String>,
    pub quantity_avail: Option<Decimal>,
    pub category: Option<String>,
    pub status: Option<String>,
    pub location_name: Option<String>,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
    pub country_code: Option<String>,
    pub currency_code: Option<String>,
    pub ships_to: Option<Vec<String>>,
    pub is_global: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ListProductsQuery {
    /// Full-text search query (PostgreSQL to_tsquery).
    pub q: Option<String>,
    /// Marketplace scope: "local" | "country" | "global" (default: "global").
    pub scope: Option<String>,
    /// ISO 3166-1 alpha-2 country filter (used when scope = "country").
    pub country: Option<String>,
    /// Filter to products that ship to this country code.
    pub ships_to: Option<String>,
    pub category: Option<String>,
    pub seller_id: Option<Uuid>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    /// Sort: "rating" | "price_asc" | "price_desc" | "newest" (default).
    pub sort: Option<String>,
    /// Opaque cursor for keyset pagination (base64url JSON with `ts` + `id`).
    /// Only honoured when `sort` is "newest" or absent and no full-text search.
    /// Supersedes `page` when present.
    pub cursor: Option<String>,
}

// ── Cursor helpers ─────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct CursorData {
    ts: DateTime<Utc>,
    id: Uuid,
}

fn decode_cursor(s: &str) -> Option<CursorData> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let bytes = URL_SAFE_NO_PAD.decode(s).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn encode_cursor(ts: DateTime<Utc>, id: Uuid) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    // Intentionally compact — no pretty-printing.
    URL_SAFE_NO_PAD.encode(serde_json::json!({"ts": ts, "id": id}).to_string())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Batch-fetch images for a list of product IDs — O(1) query instead of O(n).
async fn fetch_images_batch(
    pool: &sqlx::PgPool,
    product_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<ProductImage>>, sqlx::Error> {
    if product_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<ProductImage> = sqlx::query_as(
        "SELECT id, product_id, url, is_primary, sort_order, created_at
         FROM product_images
         WHERE product_id = ANY($1)
         ORDER BY product_id, sort_order, created_at",
    )
    .bind(product_ids)
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<Uuid, Vec<ProductImage>> = HashMap::new();
    for img in rows {
        map.entry(img.product_id).or_default().push(img);
    }
    Ok(map)
}

async fn fetch_images(
    pool: &sqlx::PgPool,
    product_id: Uuid,
) -> Result<Vec<ProductImage>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, product_id, url, is_primary, sort_order, created_at
         FROM product_images WHERE product_id = $1 ORDER BY sort_order, created_at",
    )
    .bind(product_id)
    .fetch_all(pool)
    .await
}

async fn fetch_product(pool: &sqlx::PgPool, product_id: Uuid) -> AppResult<Product> {
    let row: Option<ProductRow> = sqlx::query_as(
        "SELECT p.id, p.seller_id, f.name AS seller_name,
                p.title, p.description, p.price_kes, p.unit,
                p.quantity_avail, p.category, p.status,
                p.location_name, p.country_code, p.currency_code,
                p.ships_to, p.is_global,
                p.created_at, p.updated_at,
                pr.avg_rating, COALESCE(pr.rating_count, 0) AS rating_count
         FROM products p
         JOIN farmers f ON f.id = p.seller_id
         LEFT JOIN (
             SELECT product_id,
                    AVG(rating)::float8 AS avg_rating,
                    COUNT(*) AS rating_count
             FROM product_ratings GROUP BY product_id
         ) pr ON pr.product_id = p.id
         WHERE p.id = $1 AND p.status != 'deleted'",
    )
    .bind(product_id)
    .fetch_optional(pool)
    .await?;

    let row = row.ok_or_else(|| AppError::NotFound(format!("Product {} not found", product_id)))?;
    let images = fetch_images(pool, row.id).await?;

    Ok(row_to_product(row, images))
}

fn row_to_product(row: ProductRow, images: Vec<ProductImage>) -> Product {
    Product {
        id: row.id,
        seller_id: row.seller_id,
        seller_name: row.seller_name,
        title: row.title,
        description: row.description,
        price_kes: row.price_kes,
        unit: row.unit,
        quantity_avail: row.quantity_avail,
        category: row.category,
        status: row.status,
        location_name: row.location_name,
        country_code: row.country_code,
        currency_code: row.currency_code,
        ships_to: row.ships_to,
        is_global: row.is_global,
        images,
        avg_rating: row.avg_rating,
        rating_count: row.rating_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

/// Map Content-Type header to file extension.
/// Kept for reference only — actual file type is always determined from magic bytes.
#[allow(dead_code)]
fn content_type_to_ext(ct: &str) -> Option<&'static str> {
    match ct {
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

/// Detect the actual image type from magic bytes and return its extension.
///
/// | Format | Magic bytes                                     |
/// |--------|-------------------------------------------------|
/// | JPEG   | FF D8 FF                                        |
/// | PNG    | 89 50 4E 47 0D 0A 1A 0A                        |
/// | GIF    | 47 49 46 38 (GIF8)                              |
/// | WebP   | 52 49 46 46 __ __ __ __ 57 45 42 50 (RIFF…WEBP)|
fn detect_image_ext(data: &[u8]) -> Option<&'static str> {
    if data.len() < 4 {
        return None;
    }
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if data.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if data.len() >= 12 && data.starts_with(b"RIFF") && data[8..12] == *b"WEBP" {
        return Some("webp");
    }
    None
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// GET /api/products
///
/// Query params:
///   q         — full-text search (optional)
///   scope     — "local" | "country" | "global" (default: "global")
///   country   — ISO 3166-1 alpha-2 (used for scope=country)
///   ships_to  — filter to products that ship to this country
///   category  — category filter
///   seller_id — seller UUID filter
///   sort      — "rating" | "price_asc" | "price_desc" | "newest"
///   page, per_page — offset pagination (ignored when `cursor` present)
///   cursor    — opaque base64url cursor for keyset pagination (newest sort only)
///
/// When `cursor` is in the response headers (`X-Next-Cursor`), pass it as the
/// `cursor` query param in the next request to fetch the next page.
pub async fn list_products(
    State(state): State<SharedState>,
    Query(q): Query<ListProductsQuery>,
) -> AppResult<impl IntoResponse> {
    let per_page = q.per_page.unwrap_or(20).clamp(1, 100);

    let scope = q.scope.as_deref().unwrap_or("global");

    // Build ORDER BY clause.
    // When a search query is provided and sort=rank (or no sort specified with a query),
    // use ts_rank for relevance ordering. Otherwise fall back to date/price sorts.
    let has_query = q.q.is_some();
    let order_by = match q.sort.as_deref() {
        Some("rank") if has_query => {
            "ts_rank(p.search_vector, plainto_tsquery('english', $7)) DESC, p.created_at DESC"
        }
        Some("rating") => "COALESCE(pr.avg_rating, 0) DESC, p.created_at DESC",
        Some("price_asc") => "p.price_kes ASC",
        Some("price_desc") => "p.price_kes DESC",
        // Default: when there's a search query, rank by relevance; otherwise by date.
        _ if has_query => {
            "ts_rank(p.search_vector, plainto_tsquery('english', $7)) DESC, p.created_at DESC"
        }
        _ => "p.created_at DESC, p.id DESC",
    };

    // Cursor pagination: only supported for created_at DESC ordering (newest + no FTS).
    // For any other sort, or when a full-text query is present, fall back to OFFSET.
    let use_cursor =
        q.cursor.is_some() && !has_query && matches!(q.sort.as_deref(), None | Some("newest"));

    let cursor_data: Option<CursorData> = q
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .filter(|_| use_cursor);

    // Build the WHERE clause dynamically.
    // All optional conditions use IS NULL guards so the query plan stays stable.
    let search_clause = if q.q.is_some() {
        "AND p.search_vector @@ plainto_tsquery('english', $7)"
    } else {
        "AND ($7::text IS NULL)"
    };

    let country_clause = match scope {
        "local" | "country" => "AND p.country_code = COALESCE($8, p.country_code)",
        _ => "AND ($8::text IS NULL OR p.country_code = $8 OR p.is_global = TRUE)",
    };

    let ships_to_clause = if q.ships_to.is_some() {
        "AND $9 = ANY(p.ships_to)"
    } else {
        "AND ($9::text IS NULL)"
    };

    // Cursor condition: excludes rows at or after (later than) the cursor position.
    // Row-value comparison (a, b) < (x, y) means a < x OR (a = x AND b < y),
    // which correctly pages forward in a created_at DESC, id DESC ordering.
    // Both $10 and $11 are always referenced so PostgreSQL never sees unbound params.
    let cursor_clause = "AND ($10::timestamptz IS NULL \
           OR p.created_at < $10 \
           OR (p.created_at = $10 AND p.id < $11))";

    let base_select = "
        SELECT p.id, p.seller_id, f.name AS seller_name,
               p.title, p.description, p.price_kes, p.unit,
               p.quantity_avail, p.category, p.status,
               p.location_name, p.country_code, p.currency_code,
               p.ships_to, p.is_global,
               p.created_at, p.updated_at,
               pr.avg_rating, COALESCE(pr.rating_count, 0) AS rating_count
        FROM products p
        JOIN farmers f ON f.id = p.seller_id
        LEFT JOIN (
            SELECT product_id, AVG(rating)::float8 AS avg_rating, COUNT(*) AS rating_count
            FROM product_ratings GROUP BY product_id
        ) pr ON pr.product_id = p.id";

    // Fetch one extra row to detect whether a next page exists.
    let fetch_limit = per_page + 1;

    // When using cursor pagination, OFFSET is always 0.
    // When using legacy offset pagination, compute it from page.
    let offset = if use_cursor {
        0i64
    } else {
        let page = q.page.unwrap_or(1).max(1);
        (page - 1) * per_page
    };

    let sql = format!(
        "{base_select}
         WHERE p.status = 'active'
           AND ($1::text IS NULL OR p.category = $1)
           AND ($2::uuid IS NULL OR p.seller_id = $2)
           {country_clause}
           {ships_to_clause}
           {search_clause}
           {cursor_clause}
         ORDER BY {order_by}
         LIMIT $5 OFFSET $6",
    );

    // Parameter binding order:
    //  $1  = category
    //  $2  = seller_id
    //  $3  = placeholder (unused)
    //  $4  = placeholder (unused)
    //  $5  = limit (per_page + 1 for has-more detection)
    //  $6  = offset
    //  $7  = search query
    //  $8  = country
    //  $9  = ships_to
    //  $10 = cursor_ts (NULL when not using cursor)
    //  $11 = cursor_id (ignored when $10 IS NULL)
    let rows: Vec<ProductRow> = sqlx::query_as(&sql)
        .bind(q.category.as_deref()) // $1
        .bind(q.seller_id) // $2
        .bind(Option::<String>::None) // $3 placeholder
        .bind(Option::<String>::None) // $4 placeholder
        .bind(fetch_limit) // $5
        .bind(offset) // $6
        .bind(q.q.as_deref()) // $7
        .bind(q.country.as_deref()) // $8
        .bind(q.ships_to.as_deref()) // $9
        .bind(cursor_data.as_ref().map(|c| c.ts)) // $10
        .bind(cursor_data.as_ref().map(|c| c.id)) // $11
        .fetch_all(&state.db)
        .await?;

    // Determine whether there is a next page.
    let has_more = rows.len() as i64 > per_page;
    // Truncate to the requested page size.
    let rows: Vec<ProductRow> = rows.into_iter().take(per_page as usize).collect();

    // Build the next-cursor from the last row's (created_at, id).
    // Only emit when using cursor mode and there really is a next page.
    let next_cursor: Option<String> = if has_more && use_cursor {
        rows.last().map(|r| encode_cursor(r.created_at, r.id))
    } else if has_more && !use_cursor {
        // Emit a cursor even for offset-based first page so callers can
        // switch to cursor pagination seamlessly.
        rows.last().map(|r| encode_cursor(r.created_at, r.id))
    } else {
        None
    };

    // Batch-fetch all images in a single query (fixes N+1)
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut images_map = fetch_images_batch(&state.db, &ids).await?;

    let products: Vec<Product> = rows
        .into_iter()
        .map(|row| {
            let images = images_map.remove(&row.id).unwrap_or_default();
            row_to_product(row, images)
        })
        .collect();

    // Return next-cursor in a response header so callers can paginate without
    // changing the response body shape.
    let mut headers = HeaderMap::new();
    if let Some(ref cursor_str) = next_cursor {
        if let Ok(v) = cursor_str.parse() {
            headers.insert("x-next-cursor", v);
        }
    }

    Ok((headers, Json(products)))
}

/// GET /api/products/:id
pub async fn get_product(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Product>> {
    fetch_product(&state.db, id).await.map(Json)
}

/// POST /api/products
pub async fn create_product(
    State(state): State<SharedState>,
    claims: Claims,
    Json(body): Json<CreateProductRequest>,
) -> AppResult<(StatusCode, Json<Product>)> {
    let seller_id = claims.farmer_id.ok_or_else(|| {
        AppError::Forbidden("Must be a registered user to create listings".into())
    })?;

    let title = body.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    if title.len() > MAX_TITLE_LEN {
        return Err(AppError::BadRequest(format!(
            "title exceeds {} characters",
            MAX_TITLE_LEN
        )));
    }

    let description = body.description.as_deref().unwrap_or("").trim().to_string();
    if description.len() > MAX_DESC_LEN {
        return Err(AppError::BadRequest(format!(
            "description exceeds {} characters",
            MAX_DESC_LEN
        )));
    }

    if body.price_kes <= Decimal::ZERO {
        return Err(AppError::BadRequest("price_kes must be positive".into()));
    }
    if body.quantity_avail < Decimal::ZERO {
        return Err(AppError::BadRequest(
            "quantity_avail cannot be negative".into(),
        ));
    }

    let unit = body.unit.as_deref().unwrap_or("kg").trim().to_string();
    if unit.len() > MAX_UNIT_LEN {
        return Err(AppError::BadRequest(format!(
            "unit exceeds {} characters",
            MAX_UNIT_LEN
        )));
    }

    let category = body.category.as_deref().unwrap_or("").trim().to_string();
    if category.len() > MAX_CATEGORY_LEN {
        return Err(AppError::BadRequest(format!(
            "category exceeds {} characters",
            MAX_CATEGORY_LEN
        )));
    }

    let location_name = body
        .location_name
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if location_name.len() > MAX_LOCATION_LEN {
        return Err(AppError::BadRequest(format!(
            "location_name exceeds {} characters",
            MAX_LOCATION_LEN
        )));
    }

    let country_code = body.country_code.as_deref().unwrap_or("KE").to_uppercase();
    if country_code.len() != 2 {
        return Err(AppError::BadRequest(
            "country_code must be a 2-letter ISO 3166-1 alpha-2 code".into(),
        ));
    }

    let currency_code = body
        .currency_code
        .as_deref()
        .unwrap_or("KES")
        .to_uppercase();
    if currency_code.len() != 3 {
        return Err(AppError::BadRequest(
            "currency_code must be a 3-letter ISO 4217 code".into(),
        ));
    }

    let ships_to = body.ships_to.unwrap_or_else(|| vec![country_code.clone()]);
    let is_global = body.is_global.unwrap_or(false);

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO products
             (seller_id, title, description, price_kes, unit, quantity_avail,
              category, location_name, location_lat, location_lng,
              country_code, currency_code, ships_to, is_global)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id",
    )
    .bind(seller_id)
    .bind(&title)
    .bind(&description)
    .bind(body.price_kes)
    .bind(&unit)
    .bind(body.quantity_avail)
    .bind(&category)
    .bind(&location_name)
    .bind(body.location_lat)
    .bind(body.location_lng)
    .bind(&country_code)
    .bind(&currency_code)
    .bind(&ships_to)
    .bind(is_global)
    .fetch_one(&state.db)
    .await?;

    let product = fetch_product(&state.db, id).await?;
    Ok((StatusCode::CREATED, Json(product)))
}

/// PUT /api/products/:id
pub async fn update_product(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateProductRequest>,
) -> AppResult<Json<Product>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT seller_id FROM products WHERE id = $1 AND status != 'deleted'")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    let owner = owner.ok_or_else(|| AppError::NotFound(format!("Product {} not found", id)))?;

    if owner != user_id {
        return Err(AppError::Forbidden(
            "You can only edit your own listings".into(),
        ));
    }

    if let Some(ref title) = body.title {
        let t = title.trim();
        if t.is_empty() {
            return Err(AppError::BadRequest("title cannot be empty".into()));
        }
        if t.len() > MAX_TITLE_LEN {
            return Err(AppError::BadRequest(format!(
                "title exceeds {} characters",
                MAX_TITLE_LEN
            )));
        }
    }
    if let Some(ref desc) = body.description {
        if desc.len() > MAX_DESC_LEN {
            return Err(AppError::BadRequest(format!(
                "description exceeds {} characters",
                MAX_DESC_LEN
            )));
        }
    }
    if let Some(price) = body.price_kes {
        if price <= Decimal::ZERO {
            return Err(AppError::BadRequest("price_kes must be positive".into()));
        }
    }
    if let Some(qty) = body.quantity_avail {
        if qty < Decimal::ZERO {
            return Err(AppError::BadRequest(
                "quantity_avail cannot be negative".into(),
            ));
        }
    }
    if let Some(ref status) = body.status {
        if !["active", "paused", "sold_out"].contains(&status.as_str()) {
            return Err(AppError::BadRequest(
                "status must be active, paused, or sold_out".into(),
            ));
        }
    }

    sqlx::query(
        "UPDATE products SET
            title          = COALESCE($2, title),
            description    = COALESCE($3, description),
            price_kes      = COALESCE($4, price_kes),
            unit           = COALESCE($5, unit),
            quantity_avail = COALESCE($6, quantity_avail),
            category       = COALESCE($7, category),
            status         = COALESCE($8, status),
            location_name  = COALESCE($9, location_name),
            location_lat   = COALESCE($10, location_lat),
            location_lng   = COALESCE($11, location_lng),
            country_code   = COALESCE($12, country_code),
            currency_code  = COALESCE($13, currency_code),
            ships_to       = COALESCE($14, ships_to),
            is_global      = COALESCE($15, is_global)
         WHERE id = $1",
    )
    .bind(id)
    .bind(body.title.as_deref().map(str::trim))
    .bind(body.description.as_deref().map(str::trim))
    .bind(body.price_kes)
    .bind(body.unit.as_deref().map(str::trim))
    .bind(body.quantity_avail)
    .bind(body.category.as_deref().map(str::trim))
    .bind(&body.status)
    .bind(body.location_name.as_deref().map(str::trim))
    .bind(body.location_lat)
    .bind(body.location_lng)
    .bind(body.country_code.as_deref())
    .bind(body.currency_code.as_deref())
    .bind(body.ships_to.as_deref())
    .bind(body.is_global)
    .execute(&state.db)
    .await?;

    fetch_product(&state.db, id).await.map(Json)
}

/// DELETE /api/products/:id  (soft delete)
pub async fn delete_product(
    State(state): State<SharedState>,
    claims: Claims,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT seller_id FROM products WHERE id = $1 AND status != 'deleted'")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    let owner = owner.ok_or_else(|| AppError::NotFound(format!("Product {} not found", id)))?;

    if owner != user_id {
        return Err(AppError::Forbidden(
            "You can only delete your own listings".into(),
        ));
    }

    sqlx::query("UPDATE products SET status = 'deleted' WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// POST /api/products/:id/images
pub async fn upload_image(
    State(state): State<SharedState>,
    claims: Claims,
    Path(product_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<ProductImage>)> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT seller_id FROM products WHERE id = $1 AND status != 'deleted'")
            .bind(product_id)
            .fetch_optional(&state.db)
            .await?;

    let owner =
        owner.ok_or_else(|| AppError::NotFound(format!("Product {} not found", product_id)))?;

    if owner != user_id {
        return Err(AppError::Forbidden(
            "You can only add images to your own listings".into(),
        ));
    }

    let image_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM product_images WHERE product_id = $1")
            .bind(product_id)
            .fetch_one(&state.db)
            .await?;

    if image_count >= MAX_IMAGES_PER_PRODUCT {
        return Err(AppError::BadRequest(format!(
            "Maximum {} images per product",
            MAX_IMAGES_PER_PRODUCT
        )));
    }

    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {}", e)))?
        .ok_or_else(|| AppError::BadRequest("No file field found in request".into()))?;

    let declared_ct = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();

    // Collect bytes before MIME detection
    let data = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read file: {}", e)))?;

    if data.is_empty() {
        return Err(AppError::BadRequest("Empty file received".into()));
    }
    if data.len() > MAX_IMAGE_BYTES {
        return Err(AppError::BadRequest(format!(
            "Image exceeds maximum size of {} MB",
            MAX_IMAGE_BYTES / 1024 / 1024
        )));
    }

    // Magic-byte MIME validation — do NOT trust Content-Type header
    let ext = detect_image_ext(&data).ok_or_else(|| {
        AppError::BadRequest(format!(
            "File is not a recognised image format (declared: {}). \
             Only JPEG, PNG, WebP and GIF are accepted.",
            declared_ct
        ))
    })?;

    let file_name = format!("{}_{}.{}", product_id, Uuid::new_v4(), ext);
    let storage_key = file_name.clone();
    let file_path = format!("{}/{}", state.config.upload_dir, file_name);
    let url = format!("{}/uploads/{}", state.config.public_base_url, file_name);

    tokio::fs::write(&file_path, &data)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to save image: {}", e)))?;

    let is_primary = image_count == 0;

    let image: ProductImage = sqlx::query_as(
        "INSERT INTO product_images (product_id, storage_key, url, is_primary, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, product_id, url, is_primary, sort_order, created_at",
    )
    .bind(product_id)
    .bind(&storage_key)
    .bind(&url)
    .bind(is_primary)
    .bind(image_count as i32)
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(image)))
}

/// DELETE /api/products/:id/images/:image_id
pub async fn delete_image(
    State(state): State<SharedState>,
    claims: Claims,
    Path((product_id, image_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT seller_id FROM products WHERE id = $1 AND status != 'deleted'")
            .bind(product_id)
            .fetch_optional(&state.db)
            .await?;

    let owner =
        owner.ok_or_else(|| AppError::NotFound(format!("Product {} not found", product_id)))?;

    if owner != user_id {
        return Err(AppError::Forbidden(
            "You can only remove images from your own listings".into(),
        ));
    }

    #[derive(FromRow)]
    struct ImageRow {
        storage_key: String,
    }
    let img: Option<ImageRow> =
        sqlx::query_as("SELECT storage_key FROM product_images WHERE id = $1 AND product_id = $2")
            .bind(image_id)
            .bind(product_id)
            .fetch_optional(&state.db)
            .await?;

    let img = img.ok_or_else(|| AppError::NotFound(format!("Image {} not found", image_id)))?;

    sqlx::query("DELETE FROM product_images WHERE id = $1")
        .bind(image_id)
        .execute(&state.db)
        .await?;

    let file_path = format!("{}/{}", state.config.upload_dir, img.storage_key);
    if let Err(e) = tokio::fs::remove_file(&file_path).await {
        tracing::warn!("Could not delete image file {}: {}", file_path, e);
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}
