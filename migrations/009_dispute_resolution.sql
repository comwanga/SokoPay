-- Migration 009: Dispute resolution
-- Adds dispute metadata to orders and a dispute_evidence table for attachments.

-- ── Dispute fields on orders ──────────────────────────────────────────────────
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS dispute_reason       TEXT,
    ADD COLUMN IF NOT EXISTS dispute_opened_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispute_resolved_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispute_resolution   TEXT
        CHECK (dispute_resolution IN ('refund_buyer', 'release_seller', 'split'));

-- ── Evidence table: either party can upload files or text ────────────────────
CREATE TABLE IF NOT EXISTS dispute_evidence (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    submitter_id UUID       NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL CHECK (kind IN ('text', 'image', 'url')),
    content     TEXT        NOT NULL,    -- text body, image URL, or external URL
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_order ON dispute_evidence(order_id);

-- Admin view: open disputes ordered oldest-first for fair queue processing
CREATE OR REPLACE VIEW open_disputes AS
    SELECT
        o.id            AS order_id,
        o.dispute_reason,
        o.dispute_opened_at,
        o.total_kes,
        o.total_sats,
        sf.name         AS seller_name,
        bf.name         AS buyer_name,
        p.title         AS product_title,
        (SELECT COUNT(*) FROM dispute_evidence de WHERE de.order_id = o.id) AS evidence_count
    FROM orders o
    JOIN farmers sf ON sf.id = o.seller_id
    JOIN farmers bf ON bf.id = o.buyer_id
    JOIN products p ON p.id  = o.product_id
    WHERE o.status = 'disputed'
    ORDER BY o.dispute_opened_at ASC;
