-- Buyer ↔ seller messaging per order.
--
-- Agricultural commerce requires negotiation: buyers ask about quality, weight
-- tolerances, collection windows; sellers confirm loading times and routes.
-- Without messaging, all this happens outside the platform (WhatsApp, phone)
-- and is invisible to dispute resolution.
--
-- Design decisions:
--   • Messages are append-only — no edits or deletes (audit integrity).
--   • Only the two parties to an order (buyer + seller) plus admins can read.
--   • body length capped at 2000 chars to prevent abuse.
--   • An index on (order_id, sent_at) makes the thread query fast.

CREATE TABLE IF NOT EXISTS order_messages (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sender_id   UUID        NOT NULL REFERENCES farmers(id),
    body        TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_messages_thread
    ON order_messages (order_id, sent_at ASC);

CREATE INDEX IF NOT EXISTS idx_order_messages_sender
    ON order_messages (sender_id);
