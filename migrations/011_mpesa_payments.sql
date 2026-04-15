-- Migration 011: M-Pesa STK Push payments
--
-- Adds:
--   1. mpesa_phone on farmers  — seller's personal M-Pesa number for B2C disbursement
--   2. mpesa_payments table    — one row per STK Push attempt, linked to an order
--   3. payment_method on orders — 'lightning' | 'mpesa' (nullable until invoice created)
--
-- Architecture: buyers pay the platform Paybill via Daraja STK Push.
-- The seller's mpesa_phone is used for B2C disbursement (Phase 2), not for
-- direct buyer payment.

-- ── 1. Seller receive phone ───────────────────────────────────────────────────
ALTER TABLE farmers
    ADD COLUMN IF NOT EXISTS mpesa_phone TEXT;

-- ── 2. Payment method on orders ───────────────────────────────────────────────
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payment_method TEXT
        CHECK (payment_method IN ('lightning', 'mpesa'));

-- ── 3. M-Pesa payment records ────────────────────────────────────────────────
-- One row per STK Push. Multiple attempts are allowed (idempotency key is
-- checkout_request_id from Daraja, not order_id — a buyer may retry if they
-- dismiss the push).
CREATE TABLE IF NOT EXISTS mpesa_payments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

    -- Daraja request identifiers (returned by STK Push API)
    merchant_request_id   TEXT NOT NULL,
    checkout_request_id   TEXT NOT NULL UNIQUE,

    -- Who paid and how much
    buyer_phone           TEXT NOT NULL,        -- E.164, e.g. 254712345678
    amount_kes            NUMERIC(18,2) NOT NULL,

    -- Lifecycle
    status                TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                  'pending',    -- STK Push sent, waiting for callback
                                  'paid',       -- Daraja callback confirmed success
                                  'failed',     -- Daraja callback confirmed failure
                                  'cancelled',  -- User cancelled or timeout
                                  'expired'     -- No callback within window
                              )),

    -- Set on success by Daraja callback
    mpesa_receipt_number  TEXT,                 -- Safaricom transaction ID (e.g. QHF2AHXXXX)
    mpesa_phone_used      TEXT,                 -- phone that completed payment (may differ from PartyA)
    result_code           INTEGER,              -- 0 = success; non-zero = failure
    result_desc           TEXT,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mpesa_payments_order_id
    ON mpesa_payments(order_id);

CREATE INDEX IF NOT EXISTS idx_mpesa_payments_status
    ON mpesa_payments(status);

CREATE INDEX IF NOT EXISTS idx_mpesa_payments_created_at
    ON mpesa_payments(created_at DESC);

-- ── Auto-update updated_at ─────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER mpesa_payments_set_updated_at
    BEFORE UPDATE ON mpesa_payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
