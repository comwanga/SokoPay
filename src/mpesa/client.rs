use super::types::*;
use crate::config::Config;
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::RwLock;

struct TokenCache {
    token: String,
    expires_at: std::time::Instant,
}

pub struct MpesaClient {
    http: Client,
    config: Config,
    token_cache: Arc<RwLock<Option<TokenCache>>>,
}

impl MpesaClient {
    pub fn new(config: &Config) -> Self {
        Self {
            http: Client::builder()
                .use_rustls_tls()
                .build()
                .expect("Failed to build HTTP client"),
            config: config.clone(),
            token_cache: Arc::new(RwLock::new(None)),
        }
    }

    async fn get_token(&self) -> Result<String> {
        {
            let cache = self.token_cache.read().await;
            if let Some(ref cached) = *cache {
                if cached.expires_at > std::time::Instant::now() {
                    return Ok(cached.token.clone());
                }
            }
        }

        let credentials = format!(
            "{}:{}",
            self.config.mpesa_consumer_key, self.config.mpesa_consumer_secret
        );
        let encoded = STANDARD.encode(credentials.as_bytes());

        let resp = self
            .http
            .get(format!(
                "{}/oauth/v1/generate?grant_type=client_credentials",
                self.config.mpesa_base_url()
            ))
            .header("Authorization", format!("Basic {}", encoded))
            .send()
            .await?
            .json::<MpesaAuthResponse>()
            .await?;

        let expires_in: u64 = resp.expires_in.parse().unwrap_or(3600);
        // Subtract 60 s so we refresh before the token actually expires.
        let ttl = std::time::Duration::from_secs(expires_in.saturating_sub(60));
        let mut cache = self.token_cache.write().await;
        *cache = Some(TokenCache {
            token: resp.access_token.clone(),
            expires_at: std::time::Instant::now() + ttl,
        });

        Ok(resp.access_token)
    }

    /// Generate SecurityCredential for Daraja B2C.
    ///
    /// Sandbox: base64-encode the initiator password (Safaricom sandbox accepts this).
    /// Production: RSA-PKCS1v15-encrypt with Safaricom's public certificate, then base64.
    ///   Set MPESA_CERT_PATH to the path of the PEM public key extracted from Safaricom's cert:
    ///     openssl x509 -pubkey -noout -in SandboxCertificate.cer > pubkey.pem
    fn generate_security_credential(&self) -> Result<String> {
        if self.config.mpesa_env == "sandbox" {
            Ok(STANDARD.encode(self.config.mpesa_initiator_password.as_bytes()))
        } else {
            encrypt_rsa_pkcs1v15(
                &self.config.mpesa_initiator_password,
                &self.config.mpesa_cert_path,
            )
            .context("Failed to generate M-Pesa SecurityCredential for production")
        }
    }

    pub async fn send_b2c(
        &self,
        phone: &str,
        amount_kes: u64,
        payment_id: &str,
    ) -> Result<B2CResponse> {
        let token = self.get_token().await?;
        let phone_normalized = normalize_phone(phone)?;
        let security_credential = self.generate_security_credential()?;

        let request = B2CRequest {
            initiator_name: self.config.mpesa_initiator_name.clone(),
            security_credential,
            command_id: "BusinessPayment".into(),
            amount: amount_kes,
            party_a: self.config.mpesa_shortcode.clone(),
            party_b: phone_normalized,
            remarks: format!("Crop payment {}", payment_id),
            queue_timeout_url: self.config.mpesa_timeout_url.clone(),
            result_url: self.config.mpesa_result_url.clone(),
            occasion: "CropPayment".into(),
        };

        let resp = self
            .http
            .post(format!(
                "{}/mpesa/b2c/v1/paymentrequest",
                self.config.mpesa_base_url()
            ))
            .bearer_auth(&token)
            .json(&request)
            .send()
            .await?
            .json::<B2CResponse>()
            .await?;

        Ok(resp)
    }
}

/// RSA-PKCS1v15 encrypt `plaintext` using the public key at `pem_path`.
///
/// `pem_path` must point to a file containing a PKCS#8 SubjectPublicKeyInfo PEM
/// (`-----BEGIN PUBLIC KEY-----`).  Extract from a Safaricom X.509 certificate with:
///   openssl x509 -pubkey -noout -in <cert.cer> > pubkey.pem
fn encrypt_rsa_pkcs1v15(plaintext: &str, pem_path: &str) -> Result<String> {
    use rand_core::OsRng;
    use rsa::{pkcs8::DecodePublicKey, Pkcs1v15Encrypt, RsaPublicKey};

    let pem = std::fs::read_to_string(pem_path)
        .with_context(|| format!("Cannot read M-Pesa cert at '{}'", pem_path))?;
    let public_key =
        RsaPublicKey::from_public_key_pem(&pem).context("Failed to parse M-Pesa public key PEM")?;
    let encrypted = public_key
        .encrypt(&mut OsRng, Pkcs1v15Encrypt, plaintext.as_bytes())
        .context("RSA encryption failed")?;
    Ok(STANDARD.encode(&encrypted))
}

pub fn normalize_phone(phone: &str) -> Result<String> {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    let normalized = if digits.starts_with("254") {
        digits
    } else if let Some(stripped) = digits.strip_prefix('0') {
        format!("254{}", stripped)
    } else if digits.starts_with("7") || digits.starts_with("1") {
        format!("254{}", digits)
    } else {
        return Err(anyhow::anyhow!("Invalid phone number: {}", phone));
    };
    if normalized.len() != 12 {
        return Err(anyhow::anyhow!(
            "Phone number must be 12 digits after normalization, got: {}",
            normalized
        ));
    }
    Ok(normalized)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::normalize_phone;

    #[test]
    fn test_normalize_safaricom_07xx() {
        assert_eq!(normalize_phone("0712345678").unwrap(), "254712345678");
    }

    #[test]
    fn test_normalize_safaricom_01xx() {
        assert_eq!(normalize_phone("0112345678").unwrap(), "254112345678");
    }

    #[test]
    fn test_normalize_already_254() {
        assert_eq!(normalize_phone("254712345678").unwrap(), "254712345678");
    }

    #[test]
    fn test_normalize_with_plus() {
        assert_eq!(normalize_phone("+254712345678").unwrap(), "254712345678");
    }

    #[test]
    fn test_normalize_bare_7xx() {
        assert_eq!(normalize_phone("712345678").unwrap(), "254712345678");
    }

    #[test]
    fn test_normalize_rejects_short() {
        assert!(normalize_phone("071234567").is_err()); // 9 digits → 11 after prefix
    }

    #[test]
    fn test_normalize_rejects_unknown_prefix() {
        assert!(normalize_phone("9712345678").is_err());
    }

    #[test]
    fn test_normalize_strips_spaces_and_dashes() {
        assert_eq!(normalize_phone("+254 712-345-678").unwrap(), "254712345678");
    }
}
