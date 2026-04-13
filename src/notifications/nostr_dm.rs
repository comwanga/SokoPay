//! Nostr DM notifications for order status changes.
//!
//! When an order moves to a new status, we send an encrypted direct message
//! to the buyer or seller on their Nostr account (NIP-04, kind 4).
//!
//! Set these in your .env to enable:
//!   NOSTR_RELAY_URL    — e.g. wss://relay.damus.io
//!   NOSTR_PRIVKEY_HEX  — 32-byte hex private key for the platform account
//!
//! If either is missing, notifications are silently skipped.
//! If a send fails, it is retried up to 3 times with exponential backoff.

use crate::config::Config;
use aes::Aes256;
use cbc::{
    cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit},
    Encryptor,
};
use futures_util::SinkExt; // provides .send() on WebSocketStream
use secp256k1::{Keypair, Message, PublicKey, Secp256k1, SecretKey};
use serde::Serialize;
use sha2::Digest;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};
use uuid::Uuid;

// AES-256 in CBC mode for NIP-04 encryption
type Aes256CbcEnc = Encryptor<Aes256>;

const KIND_ENCRYPTED_DM: u64 = 4;
/// Maximum attempts to deliver a single DM before giving up.
const MAX_ATTEMPTS: u32 = 3;

// ── Nostr event (NIP-01) ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
struct NostrEvent {
    id: String,
    pubkey: String,
    created_at: u64,
    kind: u64,
    tags: Vec<Vec<String>>,
    content: String,
    sig: String,
}

// ── Public helpers ────────────────────────────────────────────────────────────

/// Returns the message text to send when an order changes status.
pub fn status_message(new_status: &str, product_title: &str, order_id: Uuid) -> String {
    let short_id = &order_id.to_string()[..8];
    match new_status {
        "paid" => format!(
            "AgriPay: Payment confirmed for order #{} ({}).",
            short_id, product_title
        ),
        "processing" => format!(
            "AgriPay: Your order #{} ({}) is now being prepared.",
            short_id, product_title
        ),
        "in_transit" => format!(
            "AgriPay: Your order #{} ({}) is on its way!",
            short_id, product_title
        ),
        "delivered" => format!(
            "AgriPay: Order #{} ({}) has been marked as delivered. \
             Please confirm receipt or raise a dispute within 48 hours.",
            short_id, product_title
        ),
        "confirmed" => format!(
            "AgriPay: Order #{} ({}) is complete. Thank you!",
            short_id, product_title
        ),
        "disputed" => format!(
            "AgriPay: A dispute was opened on order #{} ({}). \
             An admin will review it within 24 hours.",
            short_id, product_title
        ),
        "cancelled" => format!(
            "AgriPay: Order #{} ({}) has been cancelled.",
            short_id, product_title
        ),
        _ => format!(
            "AgriPay: Order #{} ({}) status changed to {}.",
            short_id, product_title, new_status
        ),
    }
}

/// Send an encrypted NIP-04 DM to `recipient_pubkey_hex`.
///
/// Errors are never propagated — DMs are best-effort and must never block
/// or fail an order status update. The function retries up to 3 times with
/// exponential backoff (500 ms, 1 s, then gives up) before logging a warning.
pub async fn send_dm(config: &Config, recipient_pubkey_hex: &str, message: &str) {
    let relay_url = match config.nostr_relay_url.as_deref() {
        Some(u) if !u.is_empty() => u.to_owned(),
        _ => {
            tracing::debug!("NOSTR_RELAY_URL not configured — skipping DM");
            return;
        }
    };
    let privkey_hex = match config.nostr_privkey_hex.as_deref() {
        Some(k) if !k.is_empty() => k.to_owned(),
        _ => {
            tracing::debug!("NOSTR_PRIVKEY_HEX not configured — skipping DM");
            return;
        }
    };

    for attempt in 0..MAX_ATTEMPTS {
        match build_and_publish(&relay_url, &privkey_hex, recipient_pubkey_hex, message).await {
            Ok(()) => {
                tracing::debug!(to = %recipient_pubkey_hex, "Nostr DM sent");
                return;
            }
            Err(e) if attempt < MAX_ATTEMPTS - 1 => {
                // Back off: 500 ms on first failure, 1 s on second.
                let wait_ms = 500 * 2u64.pow(attempt);
                tracing::warn!(
                    to = %recipient_pubkey_hex,
                    attempt = attempt + 1,
                    wait_ms,
                    error = %e,
                    "Nostr DM failed, retrying"
                );
                tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            }
            Err(e) => {
                tracing::warn!(
                    to = %recipient_pubkey_hex,
                    error = %e,
                    "Nostr DM failed after {} attempts — giving up",
                    MAX_ATTEMPTS
                );
            }
        }
    }
}

// ── Internal implementation ───────────────────────────────────────────────────

async fn build_and_publish(
    relay_url: &str,
    privkey_hex: &str,
    recipient_pubkey_hex: &str,
    message: &str,
) -> anyhow::Result<()> {
    let secp = Secp256k1::new();

    // Load our platform private key
    let privkey_bytes = hex::decode(privkey_hex)?;
    let secret_key = SecretKey::from_slice(&privkey_bytes)?;
    let keypair = Keypair::from_secret_key(&secp, &secret_key);
    let sender_xonly = keypair.x_only_public_key().0;
    let sender_pubkey_hex = hex::encode(sender_xonly.serialize());

    // Load the recipient's public key
    let recipient_bytes = hex::decode(recipient_pubkey_hex)?;
    let recipient_pubkey = if recipient_bytes.len() == 32 {
        // x-only pubkey (Nostr standard) — add 02 prefix to form a compressed point
        let mut buf = vec![0x02u8];
        buf.extend_from_slice(&recipient_bytes);
        PublicKey::from_slice(&buf)?
    } else {
        PublicKey::from_slice(&recipient_bytes)?
    };

    // Compute ECDH shared secret. NIP-04 uses only the x-coordinate.
    let shared = secp256k1::ecdh::SharedSecret::new(&recipient_pubkey, &secret_key);
    let shared_bytes = shared.secret_bytes();

    // Encrypt with real AES-256-CBC (replaces old XOR placeholder)
    let encrypted = nip04_encrypt(&shared_bytes, message.as_bytes())?;

    // Build the NIP-01 event
    let created_at = unix_now();
    let tags = vec![vec!["p".to_string(), recipient_pubkey_hex.to_string()]];
    let id_hex = event_id(
        &sender_pubkey_hex,
        created_at,
        KIND_ENCRYPTED_DM,
        &tags,
        &encrypted,
    );

    // Sign with Schnorr (BIP-340). No-aux-rand is deterministic: same input →
    // same signature, which is fine here since each message has a unique timestamp.
    let msg_bytes = hex::decode(&id_hex)?;
    let msg = Message::from_digest_slice(&msg_bytes)?;
    let sig = secp.sign_schnorr_no_aux_rand(&msg, &keypair);
    let sig_hex = hex::encode(sig.as_ref());

    let event = NostrEvent {
        id: id_hex,
        pubkey: sender_pubkey_hex,
        created_at,
        kind: KIND_ENCRYPTED_DM,
        tags,
        content: encrypted,
        sig: sig_hex,
    };

    publish(relay_url, &event).await
}

// ── NIP-04 encryption (AES-256-CBC) ──────────────────────────────────────────

/// Encrypts `plaintext` with AES-256-CBC using the given 32-byte key.
///
/// The IV is derived from SHA-256(key ‖ nanosecond_timestamp). This gives a
/// unique IV per message without requiring the `rand` crate. For the highest
/// security, swap in a random IV via `rand::thread_rng().fill_bytes(&mut iv)`.
///
/// Output format (NIP-04): `<base64_ciphertext>?iv=<base64_iv>`
fn nip04_encrypt(key: &[u8; 32], plaintext: &[u8]) -> anyhow::Result<String> {
    // Derive a unique IV from the key and current nanosecond timestamp.
    // SHA-256 output is 32 bytes; we take the first 16 as the 128-bit IV.
    let ts = unix_nanos().to_le_bytes();
    let iv_hash = sha2::Sha256::digest([key.as_ref(), ts.as_ref()].concat());
    let iv: [u8; 16] = iv_hash[..16]
        .try_into()
        .expect("SHA-256 output is always 32 bytes");

    // Encrypt with AES-256-CBC + PKCS7 padding.
    // The `cbc` crate handles padding internally — no manual byte shuffling needed.
    let ciphertext =
        Aes256CbcEnc::new(key.into(), &iv.into()).encrypt_padded_vec_mut::<Pkcs7>(plaintext);

    Ok(format!(
        "{}?iv={}",
        base64_std(&ciphertext),
        base64_std(&iv)
    ))
}

// ── Event ID (SHA-256 of canonical NIP-01 JSON) ───────────────────────────────

fn event_id(
    pubkey: &str,
    created_at: u64,
    kind: u64,
    tags: &[Vec<String>],
    content: &str,
) -> String {
    // NIP-01 specifies this exact serialisation: array with a 0 prefix.
    let serialised = serde_json::json!([0, pubkey, created_at, kind, tags, content]).to_string();
    hex::encode(sha2::Sha256::digest(serialised.as_bytes()))
}

// ── Relay publish (WebSocket) ─────────────────────────────────────────────────

/// Connect to the relay, send one EVENT message, and close.
///
/// We open a fresh connection per message rather than keeping a persistent
/// one. This is simpler and robust for low-volume notification sends; a
/// persistent multiplexed connection would be an optimisation for higher
/// throughput.
async fn publish(relay_url: &str, event: &NostrEvent) -> anyhow::Result<()> {
    let (mut ws_stream, _) = connect_async(relay_url)
        .await
        .map_err(|e| anyhow::anyhow!("WebSocket connect to '{}' failed: {}", relay_url, e))?;

    // NIP-01 wire format for publishing: ["EVENT", <event object>]
    let payload = serde_json::json!(["EVENT", event]).to_string();

    // Send directly on the stream (WebSocketStream implements Sink<Message>).
    // No need to split when we only write and don't need to read the relay's ACK.
    ws_stream
        .send(WsMessage::Text(payload))
        .await
        .map_err(|e| anyhow::anyhow!("WebSocket send failed: {}", e))?;

    tracing::debug!(relay = %relay_url, event_id = %event.id, "Nostr event published");
    Ok(())
}

// ── Utilities ─────────────────────────────────────────────────────────────────

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

/// Standard (non-URL-safe) base64 encoding without an external crate.
fn base64_std(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[(n >> 18) & 63] as char);
        out.push(CHARS[(n >> 12) & 63] as char);
        out.push(if chunk.len() > 1 {
            CHARS[(n >> 6) & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            CHARS[n & 63] as char
        } else {
            '='
        });
    }
    out
}
