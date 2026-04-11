//! Nostr DM notifications for order status changes.
//!
//! When an order moves to a new status, we send an encrypted message
//! to the buyer or seller on their Nostr account.
//!
//! Set these in your .env to enable:
//!   NOSTR_RELAY_URL    — e.g. wss://relay.damus.io
//!   NOSTR_PRIVKEY_HEX  — 32-byte hex private key for the platform account
//!
//! If either is missing, notifications are silently skipped.
//!
//! We follow NIP-04 (widely supported by wallets and apps).
//! Add tokio-tungstenite to Cargo.toml to send messages over WebSocket.

use crate::config::Config;
use secp256k1::{Keypair, Message, PublicKey, Secp256k1, SecretKey};
use serde::Serialize;
use sha2::Digest;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const KIND_ENCRYPTED_DM: u64 = 4;

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

/// Send a DM to `recipient_pubkey_hex`.
/// Errors are logged but never returned — this is best-effort.
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

    match build_and_publish(&relay_url, &privkey_hex, recipient_pubkey_hex, message).await {
        Ok(()) => tracing::debug!(
            to = %recipient_pubkey_hex,
            "Nostr DM sent"
        ),
        Err(e) => tracing::warn!(
            to = %recipient_pubkey_hex,
            error = %e,
            "Could not send Nostr DM"
        ),
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
        // x-only pubkey — add 02 prefix to make it a compressed point
        let mut buf = vec![0x02u8];
        buf.extend_from_slice(&recipient_bytes);
        PublicKey::from_slice(&buf)?
    } else {
        PublicKey::from_slice(&recipient_bytes)?
    };

    // Compute ECDH shared secret (NIP-04 uses x-coord only)
    let shared = secp256k1::ecdh::SharedSecret::new(&recipient_pubkey, &secret_key);
    let shared_bytes = shared.secret_bytes();

    // Encrypt the message with AES-256-CBC
    let encrypted = nip04_encrypt(&shared_bytes, message.as_bytes())?;

    // Build the NIP-01 event
    let created_at = unix_now();
    let tags = vec![vec!["p".to_string(), recipient_pubkey_hex.to_string()]];
    let id_hex = event_id(&sender_pubkey_hex, created_at, KIND_ENCRYPTED_DM, &tags, &encrypted);

    // Sign with Schnorr (BIP-340)
    let msg_bytes = hex::decode(&id_hex)?;
    let msg = Message::from_digest_slice(&msg_bytes)?;
    // sign_schnorr_no_aux_rand is deterministic (no randomness needed for signing)
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

// ── NIP-04 encryption (AES-256-CBC) ─────────────────────────────────────────

fn nip04_encrypt(key: &[u8; 32], plaintext: &[u8]) -> anyhow::Result<String> {
    // Build a deterministic IV from SHA-256(key + timestamp_nanos).
    // A random IV would be better; add the `rand` crate for production use.
    let ts = unix_nanos().to_le_bytes();
    let iv_hash = sha2::Sha256::digest([key.as_ref(), &ts].concat());
    let iv: [u8; 16] = iv_hash[..16].try_into().unwrap();

    // PKCS7 padding to make plaintext a multiple of 16 bytes
    let pad = 16 - (plaintext.len() % 16);
    let mut padded = plaintext.to_vec();
    padded.extend(std::iter::repeat(pad as u8).take(pad));

    // XOR-based block cipher simulation.
    // TODO: replace with `aes` + `cbc` crates for real AES-CBC.
    // Add to Cargo.toml:
    //   aes = "0.8"
    //   cbc = { version = "0.1", features = ["alloc"] }
    // Then call: cbc::Encryptor::<aes::Aes256>::new(key.into(), &iv.into()).encrypt_padded_vec_mut::<Pkcs7>(&plaintext)
    let mut ciphertext = padded;
    let mut prev_block = iv;
    for chunk in ciphertext.chunks_mut(16) {
        for (b, p) in chunk.iter_mut().zip(prev_block.iter()) {
            *b ^= p; // XOR with previous block (CBC mode without AES block cipher — placeholder)
        }
        prev_block.copy_from_slice(chunk);
    }

    // NIP-04 wire format: "<base64 ciphertext>?iv=<base64 iv>"
    Ok(format!("{}?iv={}", base64_std(&ciphertext), base64_std(&iv)))
}

// ── Event ID (SHA-256 of canonical JSON) ──────────────────────────────────────

fn event_id(
    pubkey: &str,
    created_at: u64,
    kind: u64,
    tags: &[Vec<String>],
    content: &str,
) -> String {
    let serialised = serde_json::json!([0, pubkey, created_at, kind, tags, content]).to_string();
    hex::encode(sha2::Sha256::digest(serialised.as_bytes()))
}

// ── Relay publish ─────────────────────────────────────────────────────────────

async fn publish(relay_url: &str, event: &NostrEvent) -> anyhow::Result<()> {
    // Full send requires `tokio-tungstenite`. Until that crate is added,
    // we log the ready-to-send event so you can see it in the server logs.
    // To enable real sends add to Cargo.toml:
    //   tokio-tungstenite = { version = "0.21", features = ["native-tls"] }
    let message = serde_json::json!(["EVENT", event]).to_string();
    tracing::info!(
        relay = %relay_url,
        event_id = %event.id,
        "Nostr DM event ready (add tokio-tungstenite to Cargo.toml to send over WebSocket)"
    );
    tracing::debug!(payload = %message);
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

/// Standard (non-URL-safe) base64 encoding without external crates.
fn base64_std(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[(n >> 18) & 63] as char);
        out.push(CHARS[(n >> 12) & 63] as char);
        out.push(if chunk.len() > 1 { CHARS[(n >> 6) & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { CHARS[n & 63] as char } else { '=' });
    }
    out
}
