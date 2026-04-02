use crate::config::Config;
use crate::db::Database;
use crate::lightning::LightningNode;
use crate::mpesa::MpesaClient;
use crate::oracle::RateOracle;
use std::sync::Arc;

pub struct AppState {
    pub db: Database,
    pub lightning: LightningNode,
    pub mpesa: MpesaClient,
    pub oracle: RateOracle,
    pub config: Config,
}

pub type SharedState = Arc<AppState>;
