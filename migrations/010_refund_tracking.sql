-- Migration 010: Refund tracking on payments
--
-- When a dispute is resolved in the buyer's favour, the platform attempts an
-- automatic Lightning refund. These columns record what happened so admins can
-- see which refunds succeeded and which need manual follow-up.

ALTER TABLE payments
    -- The bolt11 invoice we paid to send money back to the buyer.
    ADD COLUMN IF NOT EXISTS refund_bolt11  TEXT,

    -- Lifecycle of the refund attempt:
    --   pending         → refund initiated but not yet confirmed
    --   completed       → Lightning payment sent successfully
    --   failed          → automated attempt failed (see refund_notes)
    --   manual_required → buyer has no Lightning address, or BTCPay not configured;
    --                     an admin must process this refund outside the platform
    ADD COLUMN IF NOT EXISTS refund_status TEXT
        CHECK (refund_status IN ('pending', 'completed', 'failed', 'manual_required')),

    -- When the refund was successfully sent.
    ADD COLUMN IF NOT EXISTS refunded_at   TIMESTAMPTZ,

    -- Human-readable notes explaining a failure or manual requirement.
    ADD COLUMN IF NOT EXISTS refund_notes  TEXT;

-- Let admins quickly find payments that need manual refund action.
CREATE INDEX IF NOT EXISTS idx_payments_refund_status
    ON payments(refund_status)
    WHERE refund_status IN ('failed', 'manual_required');
