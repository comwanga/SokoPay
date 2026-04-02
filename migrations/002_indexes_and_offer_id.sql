-- Migration 002: Add offer_id column and performance indexes.
--
-- offer_id stores the hex-encoded LDK OfferId so the payment event monitor can
-- correlate incoming Lightning payments back to a payment row without ambiguity.

ALTER TABLE payments ADD COLUMN offer_id TEXT;

-- Indexes for common access patterns.
CREATE INDEX IF NOT EXISTS idx_payments_status      ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_farmer_id   ON payments(farmer_id);
CREATE INDEX IF NOT EXISTS idx_payments_offer_id    ON payments(offer_id);
CREATE INDEX IF NOT EXISTS idx_payments_mpesa_req   ON payments(mpesa_request_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at  ON payments(created_at);
