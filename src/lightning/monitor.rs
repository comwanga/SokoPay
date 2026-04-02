//! Background task that drains the LDK event queue and advances payment state.
//!
//! When a farmer pays a BOLT12 offer, LDK emits a `PaymentReceived` event.
//! This monitor correlates that event back to a database payment row via the stored
//! `offer_id` and transitions the row to `lightning_received`, making it eligible
//! for M-Pesa disbursement.

use std::time::Duration;
use crate::lightning::node::hex_encode;
use crate::state::SharedState;

/// Spawn the monitor as a detached Tokio task.
pub fn spawn(state: SharedState) {
    tokio::spawn(run(state));
}

async fn run(state: SharedState) {
    tracing::info!("Lightning payment monitor started");
    loop {
        match state.lightning.next_event() {
            Some(event) => {
                handle_event(&state, event).await;
                state.lightning.event_handled();
            }
            None => {
                // No pending event — sleep briefly before polling again.
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}

async fn handle_event(state: &SharedState, event: ldk_node::Event) {
    match event {
        ldk_node::Event::PaymentReceived {
            payment_hash,
            amount_msat,
            ..
        } => {
            let hash_hex = hex_encode(payment_hash.0);
            tracing::info!(
                payment_hash = %hash_hex,
                amount_msat,
                "Lightning payment received"
            );

            // Resolve offer_id by scanning list_payments() for this hash.
            let offer_id_hex = state.lightning.find_offer_id_for_hash(&hash_hex);

            match offer_id_hex {
                Some(offer_id) => {
                    match state
                        .db
                        .update_payment_lightning_by_offer_id(offer_id.clone(), hash_hex.clone())
                        .await
                    {
                        Ok(true) => tracing::info!(
                            offer_id = %&offer_id[..8.min(offer_id.len())],
                            payment_hash = %hash_hex,
                            "Payment advanced to lightning_received"
                        ),
                        Ok(false) => tracing::warn!(
                            offer_id = %offer_id,
                            "Received Lightning payment but no matching pending row found"
                        ),
                        Err(e) => tracing::error!(
                            "DB error updating payment for offer {}: {}",
                            offer_id,
                            e
                        ),
                    }
                }
                None => {
                    tracing::warn!(
                        payment_hash = %hash_hex,
                        "Could not resolve offer_id for PaymentReceived event; \
                         payment row will not be auto-advanced"
                    );
                }
            }
        }

        ldk_node::Event::PaymentSuccessful { payment_hash, .. } => {
            tracing::debug!(
                payment_hash = ?payment_hash,
                "Outbound payment successful (no action needed)"
            );
        }

        ldk_node::Event::PaymentFailed {
            payment_hash,
            reason,
            ..
        } => {
            tracing::warn!(
                payment_hash = ?payment_hash,
                reason = ?reason,
                "Lightning payment failed"
            );
        }

        ldk_node::Event::ChannelReady { channel_id, .. } => {
            tracing::info!(channel_id = %channel_id, "Lightning channel ready");
        }

        ldk_node::Event::ChannelClosed {
            channel_id,
            reason,
            ..
        } => {
            tracing::warn!(
                channel_id = %channel_id,
                reason = ?reason,
                "Lightning channel closed"
            );
        }

        other => {
            tracing::debug!("Unhandled Lightning event: {:?}", other);
        }
    }
}
