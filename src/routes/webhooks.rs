use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use crate::mpesa::B2CResult;
use crate::state::SharedState;

/// Validate the webhook secret embedded in the callback URL path.
/// Returns `Err` (HTTP 403) if the secret does not match `config.webhook_secret`.
fn verify_webhook_secret(state: &SharedState, secret: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if secret != state.config.webhook_secret {
        tracing::warn!("Rejected M-Pesa webhook: invalid secret in callback URL");
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Forbidden" })),
        ));
    }
    Ok(())
}

pub async fn mpesa_result(
    State(state): State<SharedState>,
    Path(secret): Path<String>,
    Json(payload): Json<B2CResult>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    verify_webhook_secret(&state, &secret)?;

    let result = &payload.result;
    tracing::info!(
        result_code = result.result_code,
        conversation_id = %result.originator_conversation_id,
        "M-Pesa B2C result received"
    );

    if result.result_code == 0 {
        if let Err(e) = state
            .db
            .complete_payment(
                result.originator_conversation_id.clone(),
                result.transaction_id.clone(),
            )
            .await
        {
            tracing::error!("Failed to complete payment {}: {}", result.transaction_id, e);
        } else {
            tracing::info!("Payment completed: {}", result.transaction_id);
        }
    } else {
        if let Err(e) = state
            .db
            .fail_payment(result.originator_conversation_id.clone())
            .await
        {
            tracing::error!(
                "Failed to mark payment as failed (conversation {}): {}",
                result.originator_conversation_id,
                e
            );
        } else {
            tracing::warn!(
                "Payment failed: code={} desc={}",
                result.result_code,
                result.result_desc
            );
        }
    }

    // Safaricom requires this exact acknowledgement body.
    Ok(Json(json!({ "ResultCode": 0, "ResultDesc": "Accepted" })))
}

pub async fn mpesa_timeout(
    State(state): State<SharedState>,
    Path(secret): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    verify_webhook_secret(&state, &secret)?;

    tracing::warn!("M-Pesa timeout callback received");

    if let Some(id) = payload
        .get("OriginatorConversationID")
        .and_then(|v| v.as_str())
    {
        if let Err(e) = state.db.fail_payment(id.to_string()).await {
            tracing::error!("Failed to mark timed-out payment as failed ({}): {}", id, e);
        }
    } else {
        tracing::warn!("M-Pesa timeout payload missing OriginatorConversationID: {:?}", payload);
    }

    Ok(Json(json!({ "ResultCode": 0, "ResultDesc": "Accepted" })))
}
