use crate::auth::jwt::Claims;
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
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
}

#[derive(Debug, Deserialize)]
pub struct ListProductsQuery {
    pub category: Option<String>,
    pub seller_id: Option<Uuid>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub sort: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
                p.location_name, p.created_at, p.updated_at,
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

    Ok(Product {
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
        images,
        avg_rating: row.avg_rating,
        rating_count: row.rating_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn content_type_to_ext(ct: &str) -> Option<&'static str> {
    match ct {
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// GET /api/products
pub async fn list_products(
    State(state): State<SharedState>,
    Query(q): Query<ListProductsQuery>,
) -> AppResult<Json<Vec<Product>>> {
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * per_page;

    let rating_join = "LEFT JOIN (
             SELECT product_id, AVG(rating)::float8 AS avg_rating, COUNT(*) AS rating_count
             FROM product_ratings GROUP BY product_id
         ) pr ON pr.product_id = p.id";

    let order_by = if q.sort.as_deref() == Some("rating") {
        "COALESCE(pr.avg_rating, 0) DESC, p.created_at DESC"
    } else {
        "p.created_at DESC"
    };

    let rows: Vec<ProductRow> = match (q.category.as_deref(), q.seller_id) {
        (Some(cat), Some(sid)) => {
            sqlx::query_as(&format!(
                "SELECT p.id, p.seller_id, f.name AS seller_name,
                    p.title, p.description, p.price_kes, p.unit,
                    p.quantity_avail, p.category, p.status,
                    p.location_name, p.created_at, p.updated_at,
                    pr.avg_rating, COALESCE(pr.rating_count, 0) AS rating_count
                 FROM products p
                 JOIN farmers f ON f.id = p.seller_id
                 {rating_join}
                 WHERE p.status = 'active' AND p.category = $1 AND p.seller_id = $2
                 ORDER BY {order_by} LIMIT $3 OFFSET $4",
            ))
            .bind(cat)
            .bind(sid)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?
        }

        (Some(cat), None) => {
            sqlx::query_as(&format!(
                "SELECT p.id, p.seller_id, f.name AS seller_name,
                    p.title, p.description, p.price_kes, p.unit,
                    p.quantity_avail, p.category, p.status,
                    p.location_name, p.created_at, p.updated_at,
                    pr.avg_rating, COALESCE(pr.rating_count, 0) AS rating_count
                 FROM products p
                 JOIN farmers f ON f.id = p.seller_id
                 {rating_join}
                 WHERE p.status = 'active' AND p.category = $1
                 ORDER BY {order_by} LIMIT $2 OFFSET $3",
            ))
            .bind(cat)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?
        }

        (None, Some(sid)) => {
            sqlx::query_as(&format!(
                "SELECT p.id, p.seller_id, f.name AS seller_name,
                    p.title, p.description, p.price_kes, p.unit,
                    p.quantity_avail, p.category, p.status,
                    p.location_name, p.created_at, p.updated_at,
                    pr.avg_rating, COALESCE(pr.rating_count, 0) AS rating_count
                 FROM products p
                 JOIN farmers f ON f.id = p.seller_id
                 {rating_join}
                 WHERE p.status != 'deleted' AND p.seller_id = $1
                 ORDER BY {order_by} LIMIT $2 OFFSET $3",
            ))
            .bind(sid)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?
        }

        (None, None) => {
            sqlx::query_as(&format!(
                "SELECT p.id, p.seller_id, f.name AS seller_name,
                    p.title, p.description, p.price_kes, p.unit,
                    p.quantity_avail, p.category, p.status,
                    p.location_name, p.created_at, p.updated_at,
                    pr.avg_rating, COALESCE(pr.rating_count, 0) AS rating_count
                 FROM products p
                 JOIN farmers f ON f.id = p.seller_id
                 {rating_join}
                 WHERE p.status = 'active'
                 ORDER BY {order_by} LIMIT $1 OFFSET $2",
            ))
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?
        }
    };

    let mut products = Vec::with_capacity(rows.len());
    for row in rows {
        let images = fetch_images(&state.db, row.id).await?;
        products.push(Product {
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
            images,
            avg_rating: row.avg_rating,
            rating_count: row.rating_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
        });
    }

    Ok(Json(products))
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

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO products
             (seller_id, title, description, price_kes, unit, quantity_avail,
              category, location_name, location_lat, location_lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

    // Verify ownership
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

    // Validate fields if provided
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
            location_lng   = COALESCE($11, location_lng)
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
/// Accepts multipart/form-data with a single field named "image".
pub async fn upload_image(
    State(state): State<SharedState>,
    claims: Claims,
    Path(product_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<ProductImage>)> {
    let user_id = claims
        .farmer_id
        .ok_or_else(|| AppError::Forbidden("Must be a registered user".into()))?;

    // Verify ownership
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

    // Enforce max images per product
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

    // Read the first field from the multipart body
    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {}", e)))?
        .ok_or_else(|| AppError::BadRequest("No file field found in request".into()))?;

    let content_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();

    let ext = content_type_to_ext(&content_type)
        .ok_or_else(|| AppError::BadRequest(format!("Unsupported image type: {}", content_type)))?;

    // Collect bytes with size limit
    let data = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read file: {}", e)))?;

    if data.len() > MAX_IMAGE_BYTES {
        return Err(AppError::BadRequest(format!(
            "Image exceeds maximum size of {} MB",
            MAX_IMAGE_BYTES / 1024 / 1024
        )));
    }

    if data.is_empty() {
        return Err(AppError::BadRequest("Empty file received".into()));
    }

    // Build storage path
    let file_name = format!("{}_{}.{}", product_id, Uuid::new_v4(), ext);
    let storage_key = file_name.clone();
    let file_path = format!("{}/{}", state.config.upload_dir, file_name);
    let url = format!("{}/uploads/{}", state.config.public_base_url, file_name);

    tokio::fs::write(&file_path, &data)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to save image: {}", e)))?;

    // First image becomes primary automatically
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

    // Verify product ownership
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

    // Get storage key before deleting
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

    // Delete the DB record
    sqlx::query("DELETE FROM product_images WHERE id = $1")
        .bind(image_id)
        .execute(&state.db)
        .await?;

    // Remove file from disk (non-fatal if it fails)
    let file_path = format!("{}/{}", state.config.upload_dir, img.storage_key);
    if let Err(e) = tokio::fs::remove_file(&file_path).await {
        tracing::warn!("Could not delete image file {}: {}", file_path, e);
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}
