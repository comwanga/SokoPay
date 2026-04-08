CREATE TABLE product_ratings (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    buyer_id    UUID        NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, buyer_id)
);

CREATE TABLE seller_ratings (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id   UUID        NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    buyer_id    UUID        NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (seller_id, buyer_id)
);

CREATE INDEX idx_product_ratings_product_id ON product_ratings(product_id);
CREATE INDEX idx_seller_ratings_seller_id ON seller_ratings(seller_id);
