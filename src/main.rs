mod auth;
mod config;
mod db;
mod error;
mod events;
mod farmers;
mod lnurl;
mod oracle;
mod orders;
mod payments;
mod products;
mod ratings;
mod routes;
mod state;

use anyhow::Result;
use axum::{
    http::{HeaderValue, Method},
    Router,
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::lnurl::LnurlClient;
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

    // ── Ensure upload directory exists ────────────────────────────────────────
    tokio::fs::create_dir_all(&config.upload_dir).await?;
    tracing::info!("Upload directory: {}", config.upload_dir);

    // ── Shared HTTP client ────────────────────────────────────────────────────
    let http = Client::builder()
        .use_rustls_tls()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    // ── Database ──────────────────────────────────────────────────────────────
    let pool = db::create_pool(&config.database_url).await?;
    db::run_migrations(&pool).await?;
    tracing::info!("Database connected and migrations applied");

    // ── Build shared state ────────────────────────────────────────────────────
    let oracle = RateOracle::new(&config, http.clone());
    let lnurl = LnurlClient::new(http.clone());

    let state = Arc::new(AppState {
        db: pool,
        config: config.clone(),
        oracle,
        lnurl,
    });

    // ── CORS ──────────────────────────────────────────────────────────────────
    let cors = build_cors(&config);

    // ── Router ────────────────────────────────────────────────────────────────
    let app = Router::new()
        .nest("/api", routes::router(state.clone()))
        .nest_service("/uploads", ServeDir::new(&config.upload_dir))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on http://{}", addr);
    axum::serve(listener, app).await?;

    Ok(())
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
        layer = layer.allow_origin(tower_http::cors::Any);
    } else {
        let origins: Vec<HeaderValue> = config
            .allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        if !origins.is_empty() {
            layer = layer.allow_origin(origins);
        }
    }

    layer.allow_headers([
        axum::http::header::CONTENT_TYPE,
        axum::http::header::AUTHORIZATION,
    ])
}
