-- Low-stock alert threshold per product.
-- When quantity_avail drops to or below this value the seller gets notified
-- (at most once per 24 hours to avoid spam).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS low_stock_threshold   NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS last_low_stock_alert_at TIMESTAMPTZ;
