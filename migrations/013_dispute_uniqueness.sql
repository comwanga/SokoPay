-- Enforce one open dispute per order.
--
-- Without this constraint, a race condition between two concurrent POST requests
-- to /api/orders/:id/dispute could insert duplicate disputes, leading to
-- conflicting resolutions and inconsistent payouts.
--
-- A partial unique index (WHERE status = 'disputed') is used so that a new
-- dispute can be filed after a previous one is resolved or cancelled.

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_one_open_dispute
    ON orders (id)
    WHERE status = 'disputed';

-- Also ensure dispute_opened_at is set whenever a dispute is opened.
-- (defensive — the handler already sets it, but the DB should enforce it)
ALTER TABLE orders
    ADD CONSTRAINT chk_dispute_has_timestamp
    CHECK (
        (status = 'disputed' AND dispute_opened_at IS NOT NULL)
        OR status != 'disputed'
    );
