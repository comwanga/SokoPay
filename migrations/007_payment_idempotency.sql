-- Migration 007: Payment idempotency & expiry
-- Prevents duplicate pending invoices per order; enables expiry-based cleanup.

-- Add expiry timestamp to payments (default 15 minutes from creation)
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL
        DEFAULT (NOW() + INTERVAL '15 minutes');

-- Store the payment_hash extracted from the bolt11 at invoice-creation time
-- (currently only set at confirmation; we now set it upfront from LNURL response)
-- Column already exists as nullable TEXT — no change needed for payment_hash.

-- Partial unique index: only one pending payment allowed per order at a time.
-- Once a payment is settled or expired, a new one can be created.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_order_pending
    ON payments(order_id)
    WHERE status = 'pending';

-- Index for the expiry worker (finds candidates efficiently)
CREATE INDEX IF NOT EXISTS idx_payments_expires_at
    ON payments(expires_at)
    WHERE status = 'pending';
