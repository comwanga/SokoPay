use crate::auth;
use crate::disputes::handlers as dispute_handlers;
use crate::farmers::api_keys as farmer_api_keys;
use crate::farmers::handlers as farmer_handlers;
use crate::farmers::referrals;
use crate::lnurl::server as lnurl_server;
use crate::oracle::handlers as oracle_handlers;
use crate::orders::handlers as order_handlers;
use crate::payments::handlers as payment_handlers;
use crate::products::handlers as product_handlers;
use crate::products::price_index;
use crate::ratings::handlers as rating_handlers;
use crate::state::SharedState;
use axum::{
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use std::sync::Arc;
use tower::limit::ConcurrencyLimitLayer;
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::KeyExtractor, GovernorError, GovernorLayer,
};

// ── IP extraction for rate limiting ──────────────────────────────────────────

/// A rate-limit key extractor that reads the real client IP from trusted proxy headers.
///
/// Header priority (first match wins):
///   1. CF-Connecting-IP — Cloudflare injects this; clients cannot forge it.
///   2. X-Real-IP        — nginx sets this via `proxy_set_header X-Real-IP $remote_addr`.
///   3. Rightmost XFF    — the entry appended by the closest upstream proxy (e.g. Railway).
///                         Leftmost entries are client-supplied and must not be trusted.
///   4. ConnectInfo      — raw socket peer address (requires into_make_service_with_connect_info).
///
/// Falls back to loopback (127.0.0.1) with a warning when no IP can be extracted,
/// so requests are rate-limited together rather than rejected outright.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrustedIpExtractor;

impl KeyExtractor for TrustedIpExtractor {
    type Key = std::net::IpAddr;

    fn extract<T>(&self, req: &axum::http::Request<T>) -> Result<Self::Key, GovernorError> {
        let headers = req.headers();

        // CF-Connecting-IP: injected by Cloudflare edge, clients cannot forge it.
        if let Some(ip) = headers
            .get("cf-connecting-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<std::net::IpAddr>().ok())
        {
            return Ok(ip);
        }

        // X-Real-IP: set by nginx via `proxy_set_header X-Real-IP $remote_addr`.
        if let Some(ip) = headers
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<std::net::IpAddr>().ok())
        {
            return Ok(ip);
        }

        // X-Forwarded-For rightmost entry: the entry appended by the closest
        // upstream proxy. Railway injects the real client IP here. The leftmost
        // entries may be client-controlled and must not be trusted.
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                s.split(',')
                    .next_back()
                    .and_then(|ip| ip.trim().parse::<std::net::IpAddr>().ok())
            })
        {
            return Ok(ip);
        }

        // Socket peer address (only present with into_make_service_with_connect_info).
        if let Some(addr) = req
            .extensions()
            .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        {
            return Ok(addr.0.ip());
        }

        // No IP found — fall back to loopback so the request is allowed through
        // rather than rejected. Rate limiting without an IP is better than
        // blocking all users whose IP we cannot identify.
        Ok(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST))
    }
}

pub fn router(_state: SharedState) -> Router<SharedState> {
    // ── Rate-limiter configs ──────────────────────────────────────────────────
    //
    // auth_governor: tight limit on login/register endpoints — these are the
    // primary brute-force and credential-stuffing targets. 1 req/s burst 5
    // is generous for legitimate use while making automated attacks impractical.
    let auth_governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(1)
            .burst_size(5)
            .key_extractor(TrustedIpExtractor)
            .finish()
            .expect("auth governor config"),
    );

    // invoice_governor: POST /payments/invoice hits an external LNURL endpoint
    // for each request — 5 req/s burst 10 per IP to prevent abuse.
    let invoice_governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(5)
            .burst_size(10)
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

    // ── Auth — strict rate limit (brute-force / credential-stuffing target) ──
    let auth_routes = Router::new()
        .route("/auth/login", post(auth::login))
        .route("/auth/nostr", post(auth::nostr_login))
        .route("/auth/pubkey", post(auth::pubkey_login))
        .route("/auth/register", post(auth::register))
        .route("/auth/refresh", post(auth::refresh_token))
        .route("/auth/logout", post(auth::logout))
        .layer(GovernorLayer {
            config: auth_governor_conf,
        });

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
        )
        .route("/farmers/:id/verify", post(farmer_handlers::verify_farmer));

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
        .route("/orders/:id", delete(order_handlers::cancel_order))
        .route(
            "/orders/:id/messages",
            get(crate::orders::messages::get_messages).post(crate::orders::messages::send_message),
        );

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
        )
        .route(
            "/payments/history",
            get(payment_handlers::list_payment_history),
        );

    // ── Lightning tip (seller-direct, no platform custody) ───────────────────
    let lnurl_routes = Router::new().route("/lnurl/tip/:seller_id", get(lnurl_server::tip_invoice));

    // ── M-Pesa B2C disbursement (seller payouts only — no buyer STK Push) ───
    let mpesa_routes = Router::new()
        .route(
            "/payments/mpesa/b2c/result",
            post(crate::mpesa::b2c::b2c_result),
        )
        .route(
            "/payments/mpesa/b2c/timeout",
            post(crate::mpesa::b2c::b2c_timeout),
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
        .route("/admin/refunds", get(dispute_handlers::list_stuck_refunds))
        .route("/admin/stats", get(dispute_handlers::platform_stats))
        .route(
            "/admin/disbursements",
            get(crate::mpesa::b2c::list_disbursements),
        );

    // ── API keys (farmer self-service) ───────────────────────────────────────
    let api_key_routes = Router::new()
        .route(
            "/api-keys",
            get(farmer_api_keys::list_api_keys).post(farmer_api_keys::create_api_key),
        )
        .route("/api-keys/:id", delete(farmer_api_keys::revoke_api_key));

    // ── Referral program ──────────────────────────────────────────────────────
    let referral_routes = Router::new()
        .route("/referrals/my-code", get(referrals::get_my_referral_code))
        .route("/referrals/stats", get(referrals::get_referral_stats))
        .route("/referrals/apply", post(referrals::apply_referral));

    // ── Price index (public) ──────────────────────────────────────────────────
    let price_index_route = Router::new().route("/price-index", get(price_index::get_price_index));

    // ── Storefront (public — no auth) ─────────────────────────────────────────
    let storefront_routes = Router::new().route(
        "/storefront/:id",
        get(crate::farmers::storefront::get_storefront),
    );

    // ── Oracle ────────────────────────────────────────────────────────────────
    let oracle_routes = Router::new().route("/oracle/rate", get(oracle_handlers::get_rate));

    // ── Health ────────────────────────────────────────────────────────────────
    let health_route = Router::new().route("/health", get(health_check));

    // ── Prometheus metrics ────────────────────────────────────────────────────
    // Exposes runtime counters for Prometheus / Grafana scraping.
    // In production, restrict access to this endpoint at the ingress/firewall
    // level so it is only reachable from your monitoring network.
    let metrics_route = Router::new().route("/metrics", get(metrics_handler));

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
        .merge(storefront_routes)
        .merge(api_key_routes)
        .merge(referral_routes)
        .merge(price_index_route)
        .merge(health_route)
        .merge(metrics_route)
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

/// GET /api/metrics
///
/// Requires `Authorization: Bearer <METRICS_TOKEN>` where METRICS_TOKEN is set
/// in the environment.  If the env var is not set, the endpoint returns 503 so
/// operators notice the misconfiguration rather than silently exposing metrics.
async fn metrics_handler(
    State(state): State<SharedState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    // Read the expected token from the environment on every request so it can
    // be rotated without a restart (the value is not cached in AppState).
    let expected_token = std::env::var("METRICS_TOKEN").unwrap_or_default();

    if expected_token.is_empty() {
        tracing::warn!(
            "METRICS_TOKEN is not set — /metrics is returning 503 until it is configured"
        );
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "METRICS_TOKEN not configured",
        )
            .into_response();
    }

    let provided = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("");

    if provided != expected_token {
        tracing::warn!("Metrics request rejected: bad or missing token");
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }

    match &state.metrics {
        Some(handle) => (
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                "text/plain; version=0.0.4; charset=utf-8",
            )],
            handle.render(),
        )
            .into_response(),
        None => (StatusCode::SERVICE_UNAVAILABLE, "metrics not available").into_response(),
    }
}
