//! Africa's Talking SMS notifications.
//!
//! Used as a fallback channel alongside Nostr DMs — many farmers have reliable
//! SMS but not a Nostr client.  All sends are fire-and-forget; a failure here
//! must never block the API response or roll back a transaction.
//!
//! Configuration (all optional; SMS is disabled when absent):
//!   AFRICAS_TALKING_API_KEY   — API key from the AT dashboard
//!   AFRICAS_TALKING_USERNAME  — AT username (usually "sandbox" in dev)
//!   AFRICAS_TALKING_SENDER_ID — Optional alphanumeric sender ID (e.g. "SokoPay")

use crate::config::Config;
use reqwest::Client;

/// Send an SMS via Africa's Talking.
///
/// * `to` — E.164 phone number (e.g. "+254712345678")
/// * `message` — plain-text body, max ~160 chars for a single SMS
///
/// Returns `Ok(())` on a 2xx response, `Err` on network or API failure.
/// Callers should log errors and continue — SMS is best-effort.
pub async fn send(http: &Client, config: &Config, to: &str, message: &str) -> anyhow::Result<()> {
    let (api_key, username) = match (
        config.africas_talking_api_key.as_deref(),
        config.africas_talking_username.as_deref(),
    ) {
        (Some(k), Some(u)) => (k, u),
        _ => anyhow::bail!("Africa's Talking not configured"),
    };

    // Build form fields.
    let mut params = vec![
        ("username", username.to_owned()),
        ("to", to.to_owned()),
        ("message", message.to_owned()),
    ];
    if let Some(sender) = config.africas_talking_sender_id.as_deref() {
        params.push(("from", sender.to_owned()));
    }

    let res = http
        .post("https://api.africastalking.com/version1/messaging")
        .header("apiKey", api_key)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        anyhow::bail!("AT SMS error {}: {}", status, body);
    }

    Ok(())
}

/// Fire-and-forget SMS wrapper that records the metric and swallows errors.
///
/// Use this in background tasks and post-commit handlers where we don't want
/// SMS failures to surface as API errors.
pub fn send_background(http: Client, config: Config, to: String, message: String) {
    tokio::spawn(async move {
        match send(&http, &config, &to, &message).await {
            Ok(()) => {
                crate::metrics::record_sms_sent(true);
                tracing::debug!(to = %to, "SMS sent");
            }
            Err(e) => {
                crate::metrics::record_sms_sent(false);
                tracing::warn!(to = %to, error = %e, "SMS send failed");
            }
        }
    });
}

// ── Message templates ─────────────────────────────────────────────────────────

pub fn order_status_message(new_status: &str, product_title: &str) -> Option<String> {
    let msg = match new_status {
        "processing" => format!(
            "SokoPay: Your order for '{}' is being prepared. You'll be notified when it ships.",
            truncate(product_title, 40)
        ),
        "in_transit" => format!(
            "SokoPay: Great news! Your order for '{}' is on its way.",
            truncate(product_title, 40)
        ),
        "delivered" => format!(
            "SokoPay: Your order for '{}' has been delivered. Please confirm receipt in the app.",
            truncate(product_title, 40)
        ),
        "confirmed" => format!(
            "SokoPay: Order for '{}' confirmed. Your payout is being processed.",
            truncate(product_title, 40)
        ),
        "disputed" => format!(
            "SokoPay: A dispute has been opened for order '{}'. Our team will review it within 48h.",
            truncate(product_title, 40)
        ),
        _ => return None,
    };
    Some(msg)
}

fn truncate(s: &str, max_chars: usize) -> &str {
    if s.chars().count() <= max_chars {
        s
    } else {
        // Find the last char boundary within max_chars
        let mut end = 0;
        for (i, _) in s.char_indices().take(max_chars) {
            end = i;
        }
        &s[..end]
    }
}
