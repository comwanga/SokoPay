use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Database error: {0}")]
    Database(String),
    #[error("Lightning error: {0}")]
    Lightning(String),
    #[error("M-Pesa error: {0}")]
    Mpesa(String),
    #[error("Oracle error: {0}")]
    Oracle(String),
    #[error("Internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Database(e) => {
                tracing::error!("Database error: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Database error".into())
            }
            AppError::Lightning(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::Mpesa(msg) => (StatusCode::BAD_GATEWAY, msg.clone()),
            AppError::Oracle(msg) => (StatusCode::BAD_GATEWAY, msg.clone()),
            AppError::Internal(e) => {
                tracing::error!("Internal error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".into(),
                )
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
