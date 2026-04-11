-- Migration 008: Global marketplace — country/currency/search/shipping support
-- Enables multi-country listings, multi-currency pricing display,
-- full-text search, and per-currency rate caching.

-- ── 1. Add country/currency/shipping columns to products ─────────────────────

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS country_code  CHAR(2)  NOT NULL DEFAULT 'KE',
    ADD COLUMN IF NOT EXISTS currency_code CHAR(3)  NOT NULL DEFAULT 'KES',
    ADD COLUMN IF NOT EXISTS ships_to      TEXT[]   NOT NULL DEFAULT ARRAY['KE'],
    ADD COLUMN IF NOT EXISTS is_global     BOOLEAN  NOT NULL DEFAULT FALSE;

-- Full-text search vector (auto-maintained by PostgreSQL)
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
        GENERATED ALWAYS AS (
            to_tsvector('english',
                coalesce(title, '') || ' ' ||
                coalesce(description, '') || ' ' ||
                coalesce(category, '') || ' ' ||
                coalesce(location_name, ''))
        ) STORED;

-- ── 2. Add country to farmers/sellers ────────────────────────────────────────

ALTER TABLE farmers
    ADD COLUMN IF NOT EXISTS country_code CHAR(2) NOT NULL DEFAULT 'KE';

-- ── 3. Normalise rate_cache to per-currency rows ──────────────────────────────
-- Previously had fixed btc_kes / btc_usd columns.
-- New schema: one row per (currency_code, rate) per fetch batch.
-- We keep the old columns for backward-compat with any un-migrated queries,
-- but add the new normalised column so the multi-currency oracle can populate it.

ALTER TABLE rate_cache
    ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'KES';

-- Backfill: tag existing rows that have btc_kes populated
UPDATE rate_cache SET currency_code = 'KES' WHERE currency_code = 'KES';

-- Add a second row per existing snapshot for USD
INSERT INTO rate_cache (btc_kes, btc_usd, currency_code, fetched_at)
SELECT btc_kes, btc_usd, 'USD', fetched_at
FROM   rate_cache
WHERE  currency_code = 'KES'
  AND  btc_usd IS NOT NULL
ON CONFLICT DO NOTHING;

-- New index for multi-currency lookups
CREATE INDEX IF NOT EXISTS idx_rate_cache_currency
    ON rate_cache(currency_code, fetched_at DESC);

-- ── 4. Indexes for global marketplace queries ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_products_country
    ON products(country_code, status);

CREATE INDEX IF NOT EXISTS idx_products_global
    ON products(is_global, status)
    WHERE is_global = TRUE;

CREATE INDEX IF NOT EXISTS idx_products_search
    ON products USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_products_ships_to
    ON products USING GIN(ships_to);

CREATE INDEX IF NOT EXISTS idx_farmers_country
    ON farmers(country_code);
