-- Allow a disbursements row for the buyer refund alongside the seller payout row.
--
-- Before this migration: one row per order (unique on order_id alone).
-- After: one 'payout' row and one 'refund' row per order are both allowed,
--        but you still can't have two 'payout' rows or two 'refund' rows
--        for the same order.
--
-- The existing ON CONFLICT (order_id) clauses in Rust code are updated to
-- ON CONFLICT (order_id, disbursement_type) in the same commit.

ALTER TABLE disbursements
    ADD COLUMN IF NOT EXISTS disbursement_type TEXT NOT NULL DEFAULT 'payout'
        CHECK (disbursement_type IN ('payout', 'refund'));

-- Replace the old single-column unique index with a two-column one
DROP INDEX IF EXISTS uq_disbursements_order;

CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursements_order_type
    ON disbursements (order_id, disbursement_type);
