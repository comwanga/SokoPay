-- Developer API key management.
--
-- Allows farmers to generate long-lived API keys for use in external
-- integrations (storefronts, bots, ERP systems) without sharing their JWT.
--
-- Security model:
--   • The raw key is returned ONCE on creation; only its SHA-256 hash is stored.
--   • Keys are prefixed `skp_` to make them identifiable in logs / secret scanners.
--   • Revoking sets revoked_at; queries always filter WHERE revoked_at IS NULL.
--   • last_used_at is updated on every authenticated request (async, best-effort).

CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id    UUID        NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,                  -- user-given label
    key_hash     TEXT        NOT NULL UNIQUE,           -- SHA-256(raw_key) hex
    key_prefix   TEXT        NOT NULL,                  -- first 12 chars of raw key
    scopes       TEXT[]      NOT NULL DEFAULT ARRAY['read:products','read:orders'],
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ
);

-- Fast lookup on authentication path: hash → row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash_active
    ON api_keys (key_hash)
    WHERE revoked_at IS NULL;

-- List keys for a farmer's dashboard.
CREATE INDEX IF NOT EXISTS idx_api_keys_farmer_active
    ON api_keys (farmer_id, created_at DESC)
    WHERE revoked_at IS NULL;
