-- Add optional email address to farmers for transactional notifications.
-- NULL means the farmer has not provided an email; all email sends silently
-- no-op when email is absent (same pattern as phone/SMS).
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_farmers_email ON farmers (email) WHERE email IS NOT NULL;
