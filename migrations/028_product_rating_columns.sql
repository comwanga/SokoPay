-- Replace the per-request GROUP BY on product_ratings with stored columns.
--
-- Before: every GET /products or GET /products/:id ran a full-table
--         GROUP BY on product_ratings to compute avg and count.
-- After:  avg and count are kept up-to-date when a rating is submitted
--         and read directly from the products row — no aggregate query needed.
--
-- Existing rows are back-filled from the live product_ratings table.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS rating_avg   FLOAT8,
    ADD COLUMN IF NOT EXISTS rating_count BIGINT NOT NULL DEFAULT 0;

-- Back-fill from existing ratings
UPDATE products p
SET rating_avg   = sub.avg_rating,
    rating_count = sub.cnt
FROM (
    SELECT product_id,
           AVG(rating)::float8 AS avg_rating,
           COUNT(*)            AS cnt
    FROM   product_ratings
    GROUP BY product_id
) sub
WHERE p.id = sub.product_id;
