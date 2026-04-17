-- Referral program.
--
-- Each farmer has a unique referral_code (8-char alphanumeric, uppercase).
-- When a new farmer registers with ?ref=CODE, a referral row is created.
-- This table is the source of truth for referral attribution — no bonuses
-- are distributed here; that's a separate (future) finance concern.

ALTER TABLE farmers
    ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- Index for quick lookup by code on signup.
CREATE INDEX IF NOT EXISTS idx_farmers_referral_code
    ON farmers (referral_code)
    WHERE referral_code IS NOT NULL;

-- Track who referred whom.
CREATE TABLE IF NOT EXISTS referrals (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID        NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    referred_id UUID        NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (referred_id)   -- one referrer per new user
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
    ON referrals (referrer_id, created_at DESC);
