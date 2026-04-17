-- Seller payout (disbursement) tracking.
--
-- When a buyer confirms delivery, the platform owes the seller their net payment
-- (gross minus commission). This table records every disbursement attempt so
-- that finance, support, and reconciliation all have a single source of truth.
--
-- Commission model (Phase 1 default: 2.5%):
--   gross_kes       = orders.total_kes  (what the buyer paid)
--   commission_kes  = gross_kes * commission_rate
--   net_kes         = gross_kes - commission_kes  (what the seller receives)
--
-- Disbursement channel: Safaricom Daraja B2C (BusinessPayment command).
-- If B2C is not configured, status stays 'manual_required' and ops must pay manually.

CREATE TABLE IF NOT EXISTS disbursements (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                UUID        NOT NULL REFERENCES orders(id),
    seller_id               UUID        NOT NULL REFERENCES farmers(id),
    gross_kes               NUMERIC(14,2) NOT NULL,
    commission_kes          NUMERIC(14,2) NOT NULL,
    net_kes                 NUMERIC(14,2) NOT NULL,
    commission_rate         NUMERIC(7,6)  NOT NULL DEFAULT 0.025000,
    seller_phone            TEXT,         -- E.164 without +, e.g. 254712345678
    status                  TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','processing','paid','failed','manual_required')),
    -- Daraja B2C response fields
    b2c_conversation_id     TEXT,
    b2c_originator_id       TEXT,
    -- Populated from B2C result callback
    mpesa_receipt           TEXT,
    result_code             INT,
    result_desc             TEXT,
    -- Timestamps
    initiated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    -- Notes for manual processing or failure diagnosis
    notes                   TEXT
);

-- One disbursement per order (we don't split payments across multiple B2C calls)
CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursements_order
    ON disbursements (order_id);

-- Fast lookup of pending/processing rows for the reconciliation worker
CREATE INDEX IF NOT EXISTS idx_disbursements_pending
    ON disbursements (initiated_at)
    WHERE status IN ('pending', 'processing');

-- Also index by seller for finance reporting
CREATE INDEX IF NOT EXISTS idx_disbursements_seller
    ON disbursements (seller_id, initiated_at DESC);

-- ── Add commission columns to orders ─────────────────────────────────────────
-- Stored on the order at creation time so historical rates are preserved even
-- if the platform changes its commission schedule later.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS commission_kes  NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(7,6);
