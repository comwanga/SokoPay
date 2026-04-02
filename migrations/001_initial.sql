CREATE TABLE IF NOT EXISTS farmers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL UNIQUE,
    cooperative TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
    id                      TEXT PRIMARY KEY,
    farmer_id               TEXT NOT NULL REFERENCES farmers(id),
    amount_sats             INTEGER NOT NULL,
    amount_kes              REAL NOT NULL,
    btc_kes_rate            REAL NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN (
                                    'pending',
                                    'lightning_received',
                                    'disbursing',
                                    'completed',
                                    'failed'
                                )),
    bolt12_offer            TEXT,
    lightning_payment_hash  TEXT,
    mpesa_ref               TEXT,
    mpesa_request_id        TEXT,
    crop_type               TEXT,
    notes                   TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_cache (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    btc_kes    REAL NOT NULL,
    btc_usd    REAL NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS payments_updated_at
AFTER UPDATE ON payments
BEGIN
    UPDATE payments SET updated_at = datetime('now') WHERE id = NEW.id;
END;
