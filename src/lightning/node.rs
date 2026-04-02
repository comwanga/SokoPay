use crate::config::Config;
use anyhow::Result;
use ldk_node::bitcoin::Network;
use ldk_node::{Builder, Node};
use std::sync::Arc;

pub struct LightningNode {
    inner: Arc<Node>,
}

impl LightningNode {
    /// Build and configure the LDK node.  Synchronous — no async work done here.
    pub fn new(config: &Config) -> Result<Self> {
        let network = match config.bitcoin_network.as_str() {
            "mainnet" | "bitcoin" => Network::Bitcoin,
            "testnet" => Network::Testnet,
            "signet" => Network::Signet,
            _ => Network::Regtest,
        };

        std::fs::create_dir_all(&config.ldk_data_dir)?;

        let mut builder = Builder::new();
        builder.set_network(network);
        builder.set_storage_dir_path(config.ldk_data_dir.clone());

        // B-5 fix: wire the Esplora chain source for live networks.
        // Regtest operates against a local bitcoind and does not need a public Esplora.
        if network != Network::Regtest && !config.esplora_url.is_empty() {
            builder.set_chain_source_esplora(config.esplora_url.clone(), None);
        }

        // Deliberately omit a listening address — route-blinded BOLT12 offers do not
        // require inbound TCP connections, so we operate as an outbound-only node.

        let node = builder
            .build()
            .map_err(|e| anyhow::anyhow!("LDK build error: {:?}", e))?;

        Ok(Self {
            inner: Arc::new(node),
        })
    }

    pub fn start(&self) -> Result<()> {
        self.inner
            .start()
            .map_err(|e| anyhow::anyhow!("LDK start error: {:?}", e))?;
        Ok(())
    }

    pub fn node_id(&self) -> String {
        self.inner.node_id().to_string()
    }

    /// Create a BOLT12 offer and return `(offer_string, offer_id_hex)`.
    ///
    /// `offer_string` — bech32-encoded offer to display as a QR code.
    /// `offer_id_hex` — hex-encoded 32-byte OfferId used to correlate the payment event
    ///                  back to this payment record in the database.
    pub fn create_offer(&self, amount_sats: u64, description: &str) -> Result<(String, String)> {
        let amount_msats = amount_sats * 1000;
        let offer = self
            .inner
            .bolt12_payment()
            .receive(amount_msats, description, None, None)
            .map_err(|e| anyhow::anyhow!("Failed to create BOLT12 offer: {:?}", e))?;

        let offer_str = offer.to_string();
        let offer_id_hex = hex_encode(offer.id().0);
        Ok((offer_str, offer_id_hex))
    }

    /// Poll the node for one pending event without blocking.
    pub fn next_event(&self) -> Option<ldk_node::Event> {
        self.inner.next_event()
    }

    /// Acknowledge the most recently returned event so LDK advances its queue.
    pub fn event_handled(&self) {
        self.inner.event_handled();
    }

    /// Given a payment hash (hex string), scan `list_payments()` for a BOLT12 offer payment
    /// with that hash and return its `offer_id` as a hex string.
    ///
    /// This avoids exposing the internal `PaymentId` / `PaymentDetails` types in the public API.
    pub fn find_offer_id_for_hash(&self, payment_hash_hex: &str) -> Option<String> {
        use ldk_node::payment::PaymentKind;
        for payment in self.inner.list_payments() {
            if let PaymentKind::Bolt12Offer {
                hash: Some(hash),
                offer_id,
                ..
            } = payment.kind
            {
                if hex_encode(hash.0) == payment_hash_hex {
                    return Some(hex_encode(offer_id.0));
                }
            }
        }
        None
    }

}

/// Encode a byte slice as a lowercase hex string.
pub fn hex_encode(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}
