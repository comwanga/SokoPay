-- Migration 012: Add BTCPay invoice ID to payments table
--
-- Stores the BTCPay Server invoice ID alongside each pending BOLT11 so that
-- the BTCPay webhook handler can auto-settle orders when a payment arrives,
-- without the buyer having to manually paste a preimage.
--
-- Nullable: rows created via seller LNURL fallback have no BTCPay invoice.

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS btcpay_invoice_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_btcpay_invoice_id
    ON payments(btcpay_invoice_id)
    WHERE btcpay_invoice_id IS NOT NULL;
