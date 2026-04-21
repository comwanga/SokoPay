-- Prevent two concurrent STK Push requests for the same order.
--
-- Without this, two simultaneous POST /payments/mpesa/stk-push calls both pass
-- the order status check, both fire a Daraja prompt to the buyer's phone, and
-- both insert a row into mpesa_payments. If the buyer confirms both prompts,
-- two M-Pesa debits go through — one is untracked in our order flow (lost money).
--
-- This partial unique index allows multiple *completed* rows per order
-- (paid, failed, cancelled) while blocking a second *pending* row.
-- The application layer checks rows_affected() = 0 and returns 409.

CREATE UNIQUE INDEX IF NOT EXISTS mpesa_payments_order_pending_unique
    ON mpesa_payments (order_id)
    WHERE status = 'pending';
