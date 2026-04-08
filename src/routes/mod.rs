use crate::auth;
use crate::farmers::handlers as farmer_handlers;
use crate::oracle::handlers as oracle_handlers;
use crate::orders::handlers as order_handlers;
use crate::payments::handlers as payment_handlers;
use crate::products::handlers as product_handlers;
use crate::ratings::handlers as rating_handlers;
use crate::state::SharedState;
use axum::{
    routing::{delete, get, patch, post},
    Json, Router,
};
use tower::limit::ConcurrencyLimitLayer;

pub fn router(_state: SharedState) -> Router<SharedState> {
    // ── Auth ─────────────────────────────────────────────────────────────────
    let auth_routes = Router::new()
        .route("/auth/login", post(auth::login))
        .route("/auth/nostr", post(auth::nostr_login))
        .route("/auth/pubkey", post(auth::pubkey_login))
        .route("/auth/register", post(auth::register));

    // ── Farmers (users/profiles) ──────────────────────────────────────────────
    let farmer_routes = Router::new()
        .route(
            "/farmers",
            get(farmer_handlers::list_farmers).post(farmer_handlers::create_farmer),
        )
        .route(
            "/farmers/:id",
            get(farmer_handlers::get_farmer)
                .put(farmer_handlers::update_farmer)
                .delete(farmer_handlers::delete_farmer),
        )
        .route(
            "/farmers/:id/analytics",
            get(farmer_handlers::get_farmer_analytics),
        )
        .route(
            "/farmers/:id/ratings",
            get(rating_handlers::get_seller_ratings).post(rating_handlers::rate_seller),
        );

    // ── Products ──────────────────────────────────────────────────────────────
    let product_routes = Router::new()
        .route(
            "/products",
            get(product_handlers::list_products).post(product_handlers::create_product),
        )
        .route(
            "/products/:id",
            get(product_handlers::get_product)
                .put(product_handlers::update_product)
                .delete(product_handlers::delete_product),
        )
        .route("/products/:id/images", post(product_handlers::upload_image))
        .route(
            "/products/:id/images/:image_id",
            delete(product_handlers::delete_image),
        )
        .route(
            "/products/:id/ratings",
            get(rating_handlers::get_product_ratings).post(rating_handlers::rate_product),
        );

    // ── Orders ────────────────────────────────────────────────────────────────
    let order_routes = Router::new()
        .route(
            "/orders",
            get(order_handlers::list_orders).post(order_handlers::create_order),
        )
        .route("/orders/:id", get(order_handlers::get_order))
        .route(
            "/orders/:id/status",
            patch(order_handlers::update_order_status),
        )
        .route("/orders/:id", delete(order_handlers::cancel_order));

    // ── Payments (non-custodial) ──────────────────────────────────────────────
    let payment_routes = Router::new()
        .route("/payments/invoice", post(payment_handlers::create_invoice))
        .route("/payments/confirm", post(payment_handlers::confirm_payment))
        .route(
            "/payments/order/:order_id",
            get(payment_handlers::get_payment_for_order),
        );

    // ── Oracle ────────────────────────────────────────────────────────────────
    let oracle_routes = Router::new().route("/oracle/rate", get(oracle_handlers::get_rate));

    // ── Health ────────────────────────────────────────────────────────────────
    let health_route = Router::new().route("/health", get(health));

    Router::new()
        .merge(auth_routes)
        .merge(farmer_routes)
        .merge(product_routes)
        .merge(order_routes)
        .merge(payment_routes)
        .merge(oracle_routes)
        .merge(health_route)
        .layer(ConcurrencyLimitLayer::new(200))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION")
    }))
}
