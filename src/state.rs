use crate::config::Config;
use crate::lnurl::LnurlClient;
use crate::mpesa::MpesaClient;
use crate::oracle::RateOracle;
use reqwest::Client;
use sqlx::PgPool;
use std::sync::Arc;

pub struct AppState {
    pub db: PgPool,
    pub config: Config,
    pub http: Client,
    pub oracle: RateOracle,
    pub lnurl: LnurlClient,
    pub mpesa: Option<MpesaClient>,
}

pub type SharedState = Arc<AppState>;
