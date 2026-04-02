use axum::extract::State;
use axum::Json;
use crate::error::AppResult;
use crate::models::DashboardStats;
use crate::state::SharedState;

pub async fn stats(State(state): State<SharedState>) -> AppResult<Json<DashboardStats>> {
    let stats = state.db.get_stats().await?;
    Ok(Json(stats))
}
