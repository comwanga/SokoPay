use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::error::{AppError, AppResult};
use crate::models::{CreatePayment, Payment, PaymentWithFarmer};
use crate::oracle::RateOracle;
use crate::state::SharedState;

const NOTES_MAX_LEN: usize = 500;

#[derive(Deserialize)]
pub struct Pagination {
    #[serde(default = "default_page")]
    page: u32,
    #[serde(default = "default_per_page")]
    per_page: u32,
}

fn default_page() -> u32 { 1 }
fn default_per_page() -> u32 { 50 }

pub async fn list(
    State(state): State<SharedState>,
    Query(pagination): Query<Pagination>,
) -> AppResult<Json<Vec<PaymentWithFarmer>>> {
    let payments = state.db.list_payments(pagination.page, pagination.per_page).await?;
    Ok(Json(payments))
}

pub async fn get_one(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> AppResult<Json<Payment>> {
    let payment = state.db.get_payment(id).await?;
    Ok(Json(payment))
}

pub async fn create(
    State(state): State<SharedState>,
    Json(req): Json<CreatePayment>,
) -> AppResult<Json<Value>> {
    if req.amount_kes <= 0.0 {
        return Err(AppError::BadRequest("Amount must be positive".into()));
    }
    if let Some(ref notes) = req.notes {
        if notes.len() > NOTES_MAX_LEN {
            return Err(AppError::BadRequest(format!(
                "Notes exceed maximum length of {} characters",
                NOTES_MAX_LEN
            )));
        }
    }

    // Validate farmer exists.
    let farmer = state.db.get_farmer(req.farmer_id.clone()).await?;

    // Get fresh rate, fall back to cached rate if the oracle is unavailable.
    let rate = match state.oracle.fetch_rate().await {
        Ok(r) => {
            state.db.upsert_rate(r.btc_kes, r.btc_usd).await.ok();
            r
        }
        Err(e) => {
            tracing::warn!("Failed to fetch live rate: {}. Falling back to cache.", e);
            let cached = state
                .db
                .get_cached_rate()
                .await
                .ok_or_else(|| AppError::Oracle("No rate available — try again shortly".into()))?;
            crate::oracle::ExchangeRate {
                btc_kes: cached.btc_kes,
                btc_usd: cached.btc_usd,
            }
        }
    };

    let amount_sats = RateOracle::kes_to_sats(req.amount_kes, rate.btc_kes);
    if amount_sats < 1000 {
        return Err(AppError::BadRequest("Amount too small (min ~1000 sats)".into()));
    }

    let description = format!(
        "Crop payment {:.0} KES - {} ({})",
        req.amount_kes, farmer.name, farmer.cooperative
    );

    // create_offer returns (offer_string, offer_id_hex).
    let (offer_str, offer_id_hex) = state
        .lightning
        .create_offer(amount_sats, &description)
        .map_err(|e| AppError::Lightning(e.to_string()))?;

    let amount_sats_db = amount_sats as i64;

    let payment = state
        .db
        .create_payment(
            req.farmer_id,
            amount_sats_db,
            req.amount_kes,
            rate.btc_kes,
            Some(offer_str.clone()),
            Some(offer_id_hex),
            req.crop_type,
            req.notes,
        )
        .await?;

    Ok(Json(json!({
        "payment": payment,
        "bolt12_offer": offer_str,
        "amount_sats": amount_sats,
        "btc_kes_rate": rate.btc_kes,
    })))
}

pub async fn disburse(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    // Fetch the payment to validate it exists and to get the farmer phone.
    let payment = state.db.get_payment(id.clone()).await?;

    if payment.status != "lightning_received" {
        return Err(AppError::BadRequest(format!(
            "Payment must be in 'lightning_received' status to disburse, current: {}",
            payment.status
        )));
    }

    let farmer = state.db.get_farmer(payment.farmer_id.clone()).await?;

    // B-3 fix: round before casting to u64 to avoid truncating fractional KES.
    let amount_kes = payment.amount_kes.round() as u64;

    let resp = state
        .mpesa
        .send_b2c(&farmer.phone, amount_kes, &id)
        .await
        .map_err(|e| AppError::Mpesa(e.to_string()))?;

    if let Some(error) = resp.error_code {
        return Err(AppError::Mpesa(format!(
            "M-Pesa error {}: {}",
            error,
            resp.error_message.unwrap_or_default()
        )));
    }

    let request_id = resp
        .originator_conversation_id
        .or(resp.conversation_id)
        .ok_or_else(|| AppError::Mpesa("No conversation ID in M-Pesa response".into()))?;

    // R-5: Atomically transition status to 'disbursing'. If another request already
    // did this (race / retry), rows_changed == 0 and we return 409 Conflict.
    let transitioned = state
        .db
        .try_start_disburse(id, request_id.clone())
        .await?;

    if !transitioned {
        return Err(AppError::BadRequest(
            "Payment is no longer in 'lightning_received' state; disbursal may already be in progress".into(),
        ));
    }

    Ok(Json(json!({
        "success": true,
        "mpesa_request_id": request_id,
        "description": resp.response_description,
    })))
}
