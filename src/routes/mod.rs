use crate::auth;
use crate::disputes::handlers as dispute_handlers;
use crate::farmers::handlers as farmer_handlers;
use crate::lnurl::server as lnurl_server;
use crate::mpesa::handlers as mpesa_handlers;
use crate::oracle::handlers as oracle_handlers;
use crate::orders::handlers as order_handlers;
use crate::payments::handlers as payment_handlers;
use crate::products::handlers as product_handlers;
use crate::ratings::handlers as rating_handlers;
use crate::state::SharedState;
use axum::{
    extract::State,
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use std::sync::Arc;
use tower::limit::ConcurrencyLimitLayer;
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::KeyExtractor, GovernorError, GovernorLayer,
};

// ── IP extraction for rate limiting ──────────────────────────────────────────

/// A rate-limit key extractor that prefers trusted proxy headers over the raw
/// X-Forwarded-For chain.
///
/// Why not SmartIpKeyExtractor's approach?
/// It reads the FIRST (leftmost) XFF entry.  A client can prepend arbitrary
/// values to XFF before the request reaches any proxy, so an attacker simply
/// writes their own IP and bypasses per-IP rate limits.
///
/// What we trust instead (in order):
///   1. CF-Connecting-IP — Cloudflare injects this at its edge; clients can't forge it.
///   2. X-Real-IP        — nginx sets this via `proxy_set_header X-Real-IP $remote_addr`.
///   3. Rightmost XFF    — the entry appended by the closest/final proxy; harder to spoof.
///   4. ConnectInfo      — raw socket peer address (requires into_make_service_with_connect_info).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrustedIpExtractor;

impl KeyExtractor for TrustedIpExtractor {
    type Key = std::net::IpAddr;

    fn extract<T>(&self, req: &axum::http::Request<T>) -> Result<Self::Key, GovernorError> {
        let headers = req.headers();

        // Try each source in trust order, parsing each to a real IpAddr so
        // garbage values are rejected rather than silently used as rate-limit keys.
        headers
            .get("CF-Connecting-IP")
            .or_else(|| headers.get("X-Real-IP"))
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<std::net::IpAddr>().ok())
            .or_else(|| {
                // Rightmost XFF entry: the one the nearest proxy added.
                // Unlike the leftmost entry (client-supplied), this is controlled
                // by infrastructure and is much harder to spoof.
                headers
                    .get("x-forwarded-for")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| {
                        s.split(',')
                            .next_back()
                            .and_then(|ip| ip.trim().parse::<std::net::IpAddr>().ok())
                    })
            })
            .or_else(|| {
                // Socket peer address — only present when the router uses
                // into_make_service_with_connect_info (not required to enable this extractor).
                req.extensions()
                    .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
                    .map(|ci| ci.0.ip())
            })
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

pub fn router(_state: SharedState) -> Router<SharedState> {
    // ── Rate-limiter configs ──────────────────────────────────────────────────
    //
    // invoice_governor: POST /payments/invoice hits an external LNURL endpoint
    // for each request — 2 req/s burst 5 per IP to prevent abuse.
    let invoice_governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(2)
            .burst_size(5)
            .key_extractor(TrustedIpExtractor)
            .finish()
            .expect("invoice governor config"),
    );

    // global_governor: lightweight limit on all other API routes — 30 req/s
    // burst 60 per IP to stop trivial scrapers without affecting legit users.
    let global_governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(30)
            .burst_size(60)
            .key_extractor(TrustedIpExtractor)
            .finish()
            .expect("global governor config"),
    );

    // ── Auth ─────────────────────────────────────────────────────────────────
    let auth_routes = Router::new()
        .route("/auth/login", post(auth::login))
        .route("/auth/nostr", post(auth::nostr_login))
        .route("/auth/pubkey", post(auth::pubkey_login))
        .route("/auth/register", post(auth::register));

    // ── Farmers ───────────────────────────────────────────────────────────────
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

    // ── Payments — tight rate limit (both endpoints call external LNURL) ────────
    let payment_invoice_route = Router::new()
        .route("/payments/invoice", post(payment_handlers::create_invoice))
        .route(
            "/payments/verify-ln",
            get(payment_handlers::verify_ln_address),
        )
        .layer(GovernorLayer {
            config: invoice_governor_conf,
        });

    let payment_other_routes = Router::new()
        .route("/payments/confirm", post(payment_handlers::confirm_payment))
        .route(
            "/payments/order/:order_id",
            get(payment_handlers::get_payment_for_order),
        );

    // ── LNURL-pay server + BTCPay webhook ────────────────────────────────────
    let lnurl_routes = Router::new()
        .route(
            "/lnurl/pay/:slug/callback",
            get(lnurl_server::lnurlp_callback),
        )
        .route("/webhooks/btcpay", post(lnurl_server::btcpay_webhook));

    // ── M-Pesa STK Push ───────────────────────────────────────────────────────
    // The callback has no JWT auth (Daraja calls it server-to-server).
    let mpesa_routes = Router::new()
        .route(
            "/payments/mpesa/stk-push",
            post(mpesa_handlers::initiate_stk_push),
        )
        .route(
            "/payments/mpesa/callback",
            post(mpesa_handlers::mpesa_callback),
        )
        .route(
            "/payments/mpesa/:checkout_id/status",
            get(mpesa_handlers::get_mpesa_status),
        );

    // ── Disputes ──────────────────────────────────────────────────────────────
    let dispute_routes = Router::new()
        .route("/orders/:id/dispute", post(dispute_handlers::open_dispute))
        .route(
            "/orders/:id/dispute/evidence",
            get(dispute_handlers::get_evidence).post(dispute_handlers::add_evidence),
        )
        .route("/admin/disputes", get(dispute_handlers::list_open_disputes))
        .route(
            "/admin/disputes/:order_id/resolve",
            patch(dispute_handlers::resolve_dispute),
        )
        .route("/admin/refunds", get(dispute_handlers::list_stuck_refunds));

    // ── Oracle ────────────────────────────────────────────────────────────────
    let oracle_routes = Router::new().route("/oracle/rate", get(oracle_handlers::get_rate));

    // ── Health ────────────────────────────────────────────────────────────────
    let health_route = Router::new().route("/health", get(health_check));

    // ── Assemble with global rate limit + concurrency cap ────────────────────
    Router::new()
        .merge(auth_routes)
        .merge(farmer_routes)
        .merge(product_routes)
        .merge(order_routes)
        .merge(payment_invoice_route)
        .merge(payment_other_routes)
        .merge(mpesa_routes)
        .merge(lnurl_routes)
        .merge(dispute_routes)
        .merge(oracle_routes)
        .merge(health_route)
        .layer(GovernorLayer {
            config: global_governor_conf,
        })
        .layer(ConcurrencyLimitLayer::new(200))
}

/// GET /api/health
///
/// Returns 200 when the service is healthy, 503 when degraded.
/// Load balancers and readiness probes should check the HTTP status code,
/// not just whether the endpoint responds at all.
async fn health_check(State(state): State<SharedState>) -> (StatusCode, Json<serde_json::Value>) {
    // A cheap query that succeeds if and only if the connection pool can
    // reach the database.  If this fails, the service cannot serve any
    // meaningful traffic, so 503 is the correct signal.
    let db_ok = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();

    let (code, status) = if db_ok {
        (StatusCode::OK, "ok")
    } else {
        tracing::error!("Health check: database unreachable");
        (StatusCode::SERVICE_UNAVAILABLE, "degraded")
    };

    (
        code,
        Json(serde_json::json!({
            "status": status,
            "version": env!("CARGO_PKG_VERSION"),
            "checks": {
                "database": if db_ok { "connected" } else { "unreachable" },
            },
        })),
    )
}
