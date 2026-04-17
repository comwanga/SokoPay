-- Add soft-delete support to farmers and orders.
--
-- Why soft deletes?
--   • Farmers: deleting a farmer row CASCADE-deletes products and orders,
--     destroying payment history and dispute evidence. We need to retain records
--     for audit, tax, and dispute resolution even after an account is closed.
--   • Orders: orders must never be hard-deleted — they are financial records.
--     Cancellation is already modelled via status='cancelled', but a hard DELETE
--     is currently possible via the API.
--
-- products already use status='deleted' as a soft-delete signal (see handlers.rs).
-- This migration aligns farmers and orders to the same pattern.

-- ── farmers ───────────────────────────────────────────────────────────────────

ALTER TABLE farmers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index: fast lookup of active farmers only.
CREATE INDEX IF NOT EXISTS idx_farmers_active
    ON farmers (created_at DESC)
    WHERE deleted_at IS NULL;

-- ── orders ────────────────────────────────────────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_active
    ON orders (created_at DESC)
    WHERE deleted_at IS NULL;

-- ── Audit helper: record who deleted and when ─────────────────────────────────
-- The application layer sets deleted_at = NOW() rather than issuing DELETE.
-- Existing hard-DELETE paths in the API will be converted to soft deletes.
