mod auth;
mod config;
mod db;
mod disputes;
mod error;
mod events;
mod farmers;
mod lnurl;
mod metrics;
mod mpesa;
mod notifications;
mod oracle;
mod orders;
mod payments;
mod products;
mod ratings;
mod routes;
mod state;
mod workers;

use anyhow::{Context, Result};
use axum::{
    http::{HeaderValue, Method},
    Router,
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::lnurl::{server as lnurl_server, LnurlClient};
use crate::mpesa::client::{DarajaEnv, MpesaClient};
use crate::oracle::RateOracle;
use crate::state::AppState;
use reqwest::Client;

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    let config = Config::from_env()?;

    // ── Logging ───────────────────────────────────────────────────────────────
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "agri_pay=debug,tower_http=debug".into());

    if config.log_format == "json" {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer())
            .init();
    }

    tracing::info!("Starting agri-pay v{}", env!("CARGO_PKG_VERSION"));

    // ── Ensure upload directory exists and is writable ───────────────────────
    tokio::fs::create_dir_all(&config.upload_dir)
        .await
        .with_context(|| format!("Failed to create upload directory '{}'", config.upload_dir))?;

    // Verify we can actually write there. A directory that exists but isn't
    // writable will silently fail image uploads later at the worst moment.
    let write_probe = std::path::Path::new(&config.upload_dir).join(".write_probe");
    tokio::fs::write(&write_probe, b"").await.with_context(|| {
        format!(
            "Upload directory '{}' exists but is not writable",
            config.upload_dir
        )
    })?;
    tokio::fs::remove_file(&write_probe).await.ok(); // clean up; non-fatal if it fails
    tracing::info!("Upload directory verified writable: {}", config.upload_dir);

    // ── Shared HTTP client ────────────────────────────────────────────────────
    let http = Client::builder()
        .use_rustls_tls()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    // ── Metrics ───────────────────────────────────────────────────────────────
    // Install the global Prometheus recorder early so that any counter/gauge
    // calls during startup (e.g. from the workers) land in the right registry.
    let metrics_handle = match metrics::init() {
        Ok(h) => {
            tracing::info!("Prometheus metrics enabled — scrape at GET /api/metrics");
            Some(h)
        }
        Err(e) => {
            tracing::warn!("Prometheus metrics disabled: {}", e);
            None
        }
    };

    // ── Database ──────────────────────────────────────────────────────────────
    let pool = db::create_pool(&config.database_url).await?;
    db::run_migrations(&pool).await?;
    tracing::info!("Database connected and migrations applied");

    // ── Build shared state ────────────────────────────────────────────────────
    let oracle = RateOracle::new(&config, http.clone());
    let lnurl = LnurlClient::new(http.clone());

    let mpesa: Option<MpesaClient> =
        if let (Some(key), Some(secret), Some(shortcode), Some(passkey), Some(cb_url)) = (
            config.mpesa_consumer_key.clone(),
            config.mpesa_consumer_secret.clone(),
            config.mpesa_shortcode.clone(),
            config.mpesa_passkey.clone(),
            config.mpesa_callback_url.clone(),
        ) {
            let env = DarajaEnv::from_str(&config.mpesa_env);
            tracing::info!("M-Pesa STK Push enabled ({:?})", env);
            Some(MpesaClient::new(
                http.clone(),
                env,
                key,
                secret,
                shortcode,
                passkey,
                cb_url,
            ))
        } else {
            tracing::info!("M-Pesa not configured — STK Push disabled");
            None
        };

    if config.smtp_host.is_some() {
        tracing::info!(
            "Transactional email enabled (SMTP: {})",
            config.smtp_host.as_deref().unwrap_or("")
        );
    } else {
        tracing::info!("Transactional email not configured — SMTP_HOST not set");
    }

    let state = Arc::new(AppState {
        db: pool.clone(),
        config: config.clone(),
        http: http.clone(),
        oracle,
        lnurl,
        mpesa,
        metrics: metrics_handle,
    });

    // ── Background workers ────────────────────────────────────────────────────
    // We keep the JoinHandle so we can detect a panic or unexpected exit.
    // If the worker stops, payments stop expiring and stock is never restored —
    // that is a serious operational failure, so we exit the whole process and
    // let the supervisor (Docker, systemd, k8s) restart it cleanly.
    let expiry_worker = tokio::spawn(workers::payment_expiry::run(pool.clone()));
    tracing::info!("Payment expiry worker started (poll interval: 60s)");

    // Dispute timeout worker: auto-resolves disputes older than 7 days.
    // Not exit-critical — if it stops, old disputes simply aren't auto-closed.
    tokio::spawn(workers::dispute_timeout::run(state.clone()));
    tracing::info!("Dispute timeout worker started (poll interval: 24h)");

    // Disbursement reconciliation worker: marks stale B2C payouts as manual_required.
    // Not exit-critical — stale payouts are surfaced to finance via /admin/disbursements.
    tokio::spawn(workers::disbursement::run(state.clone()));
    tracing::info!("Disbursement reconciliation worker started (poll interval: 10m)");

    // ── CORS ──────────────────────────────────────────────────────────────────
    let cors = build_cors(&config);

    // ── Router ────────────────────────────────────────────────────────────────
    // /.well-known/lnurlp/{slug} is mounted at root (not under /api)
    // as required by the LNURL-pay spec (LUD-06).
    let app = Router::new()
        .route(
            "/.well-known/lnurlp/:slug",
            axum::routing::get(lnurl_server::lnurlp_descriptor),
        )
        .nest("/api", routes::router(state.clone()))
        .nest_service("/uploads", ServeDir::new(&config.upload_dir))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // Request ID layers sit outside the trace layer so the ID is stamped on
        // the request before tracing sees it, and copied back into the response
        // so clients can include it in bug reports.
        // Execution order (outermost → innermost): SetRequestId → Propagate → Trace → handler
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on http://{}", addr);

    // Race the HTTP server against the background worker.
    // Normal operation: server runs until a shutdown signal, then both stop cleanly.
    // Abnormal: if the worker exits for any reason, we exit immediately so the
    // supervisor can restart the whole process rather than running half a service.
    tokio::select! {
        result = axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).with_graceful_shutdown(shutdown_signal()) => {
            if let Err(e) = result {
                tracing::error!("Server error: {}", e);
                return Err(e.into());
            }
            tracing::info!("Server shut down gracefully");
        }
        result = expiry_worker => {
            match result {
                Ok(()) => tracing::error!(
                    "Payment expiry worker exited unexpectedly — \
                     expired invoices will not be cleaned up"
                ),
                Err(e) => tracing::error!(
                    "Payment expiry worker panicked: {} — \
                     expired invoices will not be cleaned up",
                    e
                ),
            }
            // Exit non-zero so Docker/systemd/k8s knows to restart.
            std::process::exit(1);
        }
    }

    Ok(())
}

/// Resolves when the process receives Ctrl-C (all platforms) or SIGTERM (Unix).
///
/// Axum's `with_graceful_shutdown` calls this future and waits for it to
/// resolve before closing the server. In-flight requests are allowed to
/// complete; no new connections are accepted.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl-C handler");
    };

    // SIGTERM is the standard container stop signal (Docker, k8s).
    // On Windows it doesn't exist, so we fall back to pending (Ctrl-C only).
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c   => tracing::info!("Received Ctrl-C — starting graceful shutdown"),
        _ = terminate => tracing::info!("Received SIGTERM — starting graceful shutdown"),
    }
}

fn build_cors(config: &Config) -> CorsLayer {
    let methods = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::OPTIONS,
        Method::PATCH,
    ];

    let mut layer = CorsLayer::new().allow_methods(methods);

    if config.allowed_origins.iter().any(|o| o == "*") {
        // Wildcard: no credentials can be sent (browser CORS spec requirement).
        // Config validation already blocked this in non-dev environments.
        layer = layer.allow_origin(tower_http::cors::Any);
    } else {
        let origins: Vec<HeaderValue> = config
            .allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        if !origins.is_empty() {
            // With an explicit allow-list we can also allow credentials
            // (cookies, Authorization header) — required for JWT-authenticated calls.
            layer = layer.allow_origin(origins).allow_credentials(true);
        }
    }

    layer.allow_headers([
        axum::http::header::CONTENT_TYPE,
        axum::http::header::AUTHORIZATION,
    ])
}
