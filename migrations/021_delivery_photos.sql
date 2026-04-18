-- Delivery photo proof: sellers can attach a photo URL when fulfilling an order.
-- A single URL per order is sufficient for MVP; extend to a table if needed later.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_photo_url TEXT;
