-- Token revocation table.
--
-- When a user logs out, or when an admin revokes a session, the token's
-- jti (JWT ID) is inserted here. The Claims extractor checks this table
-- on every authenticated request and rejects tokens whose jti is present.
--
-- expires_at lets rows be cleaned up once the token's natural expiry has
-- passed — an expired token would be rejected by JWT validation anyway,
-- so the revocation entry is no longer needed.

CREATE TABLE IF NOT EXISTS jwt_revocations (
    jti        UUID        PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);

-- Index used by the cleanup query (DELETE WHERE expires_at < NOW())
CREATE INDEX IF NOT EXISTS idx_jwt_revocations_expires
    ON jwt_revocations (expires_at);
