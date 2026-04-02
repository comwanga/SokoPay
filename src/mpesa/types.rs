use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct B2CRequest {
    #[serde(rename = "InitiatorName")]
    pub initiator_name: String,
    #[serde(rename = "SecurityCredential")]
    pub security_credential: String,
    #[serde(rename = "CommandID")]
    pub command_id: String,
    #[serde(rename = "Amount")]
    pub amount: u64,
    #[serde(rename = "PartyA")]
    pub party_a: String,
    #[serde(rename = "PartyB")]
    pub party_b: String,
    #[serde(rename = "Remarks")]
    pub remarks: String,
    #[serde(rename = "QueueTimeOutURL")]
    pub queue_timeout_url: String,
    #[serde(rename = "ResultURL")]
    pub result_url: String,
    #[serde(rename = "Occasion")]
    pub occasion: String,
}

#[derive(Debug, Deserialize)]
pub struct B2CResponse {
    #[serde(rename = "ConversationID")]
    pub conversation_id: Option<String>,
    #[serde(rename = "OriginatorConversationID")]
    pub originator_conversation_id: Option<String>,
    #[serde(rename = "ResponseCode")]
    pub response_code: Option<String>,
    #[serde(rename = "ResponseDescription")]
    pub response_description: Option<String>,
    #[serde(rename = "errorCode")]
    pub error_code: Option<String>,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MpesaAuthResponse {
    pub access_token: String,
    pub expires_in: String,
}

#[derive(Debug, Deserialize)]
pub struct B2CResult {
    #[serde(rename = "Result")]
    pub result: B2CResultBody,
}

#[derive(Debug, Deserialize)]
pub struct B2CResultBody {
    #[serde(rename = "ResultType")]
    pub result_type: i32,
    #[serde(rename = "ResultCode")]
    pub result_code: i32,
    #[serde(rename = "ResultDesc")]
    pub result_desc: String,
    #[serde(rename = "OriginatorConversationID")]
    pub originator_conversation_id: String,
    #[serde(rename = "ConversationID")]
    pub conversation_id: String,
    #[serde(rename = "TransactionID")]
    pub transaction_id: String,
    #[serde(rename = "ResultParameters")]
    pub result_parameters: Option<serde_json::Value>,
}
