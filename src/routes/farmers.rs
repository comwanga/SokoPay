use crate::error::{AppError, AppResult};
use crate::models::{CreateFarmer, Farmer};
use crate::state::SharedState;
use axum::{
    extract::{Path, State},
    Json,
};

const NAME_MAX_LEN: usize = 200;
const COOPERATIVE_MAX_LEN: usize = 200;

pub async fn list(State(state): State<SharedState>) -> AppResult<Json<Vec<Farmer>>> {
    let farmers = state.db.list_farmers().await?;
    Ok(Json(farmers))
}

pub async fn create(
    State(state): State<SharedState>,
    Json(req): Json<CreateFarmer>,
) -> AppResult<Json<Farmer>> {
    let name = req.name.trim().to_string();
    let phone = req.phone.trim().to_string();
    let cooperative = req.cooperative.trim().to_string();

    if name.is_empty() {
        return Err(AppError::BadRequest("Name is required".into()));
    }
    if name.len() > NAME_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Name exceeds maximum length of {} characters",
            NAME_MAX_LEN
        )));
    }
    if phone.is_empty() {
        return Err(AppError::BadRequest("Phone number is required".into()));
    }
    if cooperative.is_empty() {
        return Err(AppError::BadRequest("Cooperative is required".into()));
    }
    if cooperative.len() > COOPERATIVE_MAX_LEN {
        return Err(AppError::BadRequest(format!(
            "Cooperative name exceeds maximum length of {} characters",
            COOPERATIVE_MAX_LEN
        )));
    }

    // Validate phone format via the M-Pesa normalization logic (Kenya numbers only).
    crate::mpesa::normalize_phone(&phone)
        .map_err(|e| AppError::BadRequest(format!("Invalid phone number: {}", e)))?;

    let farmer = state
        .db
        .create_farmer(CreateFarmer {
            name,
            phone,
            cooperative,
        })
        .await?;
    Ok(Json(farmer))
}

pub async fn get_one(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> AppResult<Json<Farmer>> {
    let farmer = state.db.get_farmer(id).await?;
    Ok(Json(farmer))
}
