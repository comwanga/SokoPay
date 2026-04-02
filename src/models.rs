use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Farmer {
    pub id: String,
    pub name: String,
    pub phone: String,
    pub cooperative: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateFarmer {
    pub name: String,
    pub phone: String,
    pub cooperative: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    pub id: String,
    pub farmer_id: String,
    pub amount_sats: i64,
    pub amount_kes: f64,
    pub btc_kes_rate: f64,
    pub status: String,
    pub bolt12_offer: Option<String>,
    /// Hex-encoded OfferId from the LDK node, used to correlate incoming Lightning payments.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offer_id: Option<String>,
    pub lightning_payment_hash: Option<String>,
    pub mpesa_ref: Option<String>,
    pub mpesa_request_id: Option<String>,
    pub crop_type: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreatePayment {
    pub farmer_id: String,
    pub amount_kes: f64,
    pub crop_type: Option<String>,
    /// Free-form notes; capped at 500 characters in the handler.
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PaymentWithFarmer {
    #[serde(flatten)]
    pub payment: Payment,
    pub farmer_name: String,
    pub farmer_phone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateCache {
    pub id: i64,
    pub btc_kes: f64,
    pub btc_usd: f64,
    pub fetched_at: String,
}

#[derive(Debug, Serialize)]
pub struct DashboardStats {
    pub total_farmers: i64,
    pub total_payments: i64,
    pub total_paid_kes: f64,
    pub total_paid_sats: i64,
    pub pending_disbursements: i64,
    pub recent_rate: Option<f64>,
}
