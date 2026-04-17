//! Transactional email via SMTP (lettre).
//!
//! All sends are fire-and-forget — a mail failure never blocks or rolls back
//! a business operation.  Use `send_background()` for most call sites.
//!
//! Configuration (all optional; email is silently disabled when absent):
//!   SMTP_HOST         — e.g. "smtp.gmail.com" or "smtp.sendgrid.net"
//!   SMTP_PORT         — defaults to 587 (STARTTLS)
//!   SMTP_USER         — login username
//!   SMTP_PASS         — login password / API key
//!   EMAIL_FROM        — "SokoPay <noreply@sokopay.app>"
//!
//! Logs `[email]` prefix at DEBUG level so email activity is easily grepped.

use crate::config::Config;
use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};

/// Send a plain-text email.
///
/// Returns `Ok(())` on successful submission to the SMTP relay.
/// Returns `Err` if SMTP is unconfigured or transmission fails.
pub async fn send_text(
    config: &Config,
    to: &str,
    subject: &str,
    body: &str,
) -> anyhow::Result<()> {
    let (host, user, pass, from) = match (
        config.smtp_host.as_deref(),
        config.smtp_user.as_deref(),
        config.smtp_pass.as_deref(),
        config.email_from.as_deref(),
    ) {
        (Some(h), Some(u), Some(p), Some(f)) => (h, u, p, f),
        _ => anyhow::bail!("SMTP not configured"),
    };

    let port = config.smtp_port.unwrap_or(587);

    let message = Message::builder()
        .from(from.parse()?)
        .to(to.parse()?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_owned())?;

    let creds = Credentials::new(user.to_owned(), pass.to_owned());

    let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?
        .port(port)
        .credentials(creds)
        .build();

    transport.send(message).await?;
    Ok(())
}

/// Fire-and-forget email helper: logs errors, never panics.
pub fn send_background(
    config: Config,
    to: String,
    subject: String,
    body: String,
) {
    if config.smtp_host.is_none() {
        return; // silent no-op when SMTP is not configured
    }
    tokio::spawn(async move {
        match send_text(&config, &to, &subject, &body).await {
            Ok(()) => tracing::debug!(to = %to, subject = %subject, "[email] sent"),
            Err(e) => tracing::warn!(to = %to, error = %e, "[email] send failed"),
        }
    });
}

// ── Message templates ─────────────────────────────────────────────────────────

pub fn order_confirmed_seller(seller_name: &str, product_title: &str, total_kes: &str) -> (String, String) {
    let subject = format!("SokoPay: Order for '{}' confirmed", truncate(product_title, 40));
    let body = format!(
        "Hi {},\n\n\
         Great news! Your order for '{}' has been confirmed by the buyer.\n\n\
         Amount: KES {}\n\
         Your payout (minus 2.5% commission) is being processed.\n\n\
         — The SokoPay Team",
        seller_name,
        product_title,
        total_kes,
    );
    (subject, body)
}

pub fn disbursement_paid(seller_name: &str, net_kes: &str, receipt: &str) -> (String, String) {
    let subject = "SokoPay: Your M-Pesa payout has been sent".to_owned();
    let body = format!(
        "Hi {},\n\n\
         KES {} has been sent to your M-Pesa.\n\
         M-Pesa receipt: {}\n\n\
         — The SokoPay Team",
        seller_name, net_kes, receipt,
    );
    (subject, body)
}

pub fn dispute_opened(
    recipient_name: &str,
    product_title: &str,
    is_seller: bool,
) -> (String, String) {
    let subject = format!(
        "SokoPay: Dispute opened for '{}'",
        truncate(product_title, 40)
    );
    let role = if is_seller { "seller" } else { "buyer" };
    let body = format!(
        "Hi {},\n\n\
         A dispute has been opened for the order '{}' where you are the {}.\n\
         Our team will review it within 48 hours.\n\n\
         You can add evidence in the SokoPay app.\n\n\
         — The SokoPay Team",
        recipient_name, product_title, role,
    );
    (subject, body)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_owned()
    } else {
        let end = s.char_indices().nth(max).map(|(i, _)| i).unwrap_or(s.len());
        format!("{}…", &s[..end])
    }
}
