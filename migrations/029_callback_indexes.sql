-- Indexes for the two columns hit by every Daraja callback handler.
--
-- mpesa_callback does: WHERE checkout_request_id = $1
-- b2c_result does:     WHERE b2c_conversation_id = $1
--
-- Without these, every Daraja callback does a sequential scan.
-- Both columns are unique (or nearly so) in practice, making the index
-- extremely selective and fast.

CREATE INDEX IF NOT EXISTS idx_mpesa_payments_checkout_request_id
    ON mpesa_payments (checkout_request_id);

CREATE INDEX IF NOT EXISTS idx_disbursements_b2c_conversation_id
    ON disbursements (b2c_conversation_id)
    WHERE b2c_conversation_id IS NOT NULL;
