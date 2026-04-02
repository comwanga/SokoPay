mod config;
mod db;
mod error;
mod lightning;
mod models;
mod mpesa;
mod oracle;
mod routes;
mod state;

use anyhow::Result;
use axum::{
    http::{HeaderValue, Method},
    Router,
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::db::Database;
use crate::lightning::LightningNode;
use crate::mpesa::MpesaClient;
use crate::oracle::RateOracle;
use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    let config = Config::from_env()?;

    // ── Logging ───────────────────────────────────────────────────────────────
    // D-4: emit JSON in production (LOG_FORMAT=json), human-readable text in dev.
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

    // ── Database ──────────────────────────────────────────────────────────────
    let db = Database::new(&config.database_url).await?;
    db.run_migrations().await?;

    // ── Lightning node ────────────────────────────────────────────────────────
    // Q-2: new() is sync — no async needed.
    let lightning = LightningNode::new(&config)?;
    lightning.start()?;
    tracing::info!("Lightning node started. Node ID: {}", lightning.node_id());

    // ── External services ─────────────────────────────────────────────────────
    let mpesa = MpesaClient::new(&config);
    let oracle = RateOracle::new(&config);

    let state = Arc::new(AppState {
        db,
        lightning,
        mpesa,
        oracle,
        config: config.clone(),
    });

    // ── Background: Lightning payment event monitor (B-4) ─────────────────────
    lightning::monitor::spawn(state.clone());

    // ── CORS (S-4: restrict to configured origins) ────────────────────────────
    let cors = build_cors(&config);

    // ── Router ────────────────────────────────────────────────────────────────
    let app = Router::new()
        .nest("/api", routes::router(state.clone()))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Q-1: use config.host and config.port (not hardcoded "0.0.0.0:3001").
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
        axum::http::header::HeaderName::from_static("x-api-key"),
    ])
}
