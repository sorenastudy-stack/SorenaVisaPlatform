-- Add emailHash column + unique index to User, LeadCapture, Contact models.
-- emailHash stores HMAC-SHA256(secret, normalized_email) as 64-char lowercase hex.
-- See backend/src/common/email-hash/email-hash.service.ts (PR-SEC2a).
-- Nullable on purpose: existing rows are not backfilled here; emailHash is set
-- by the application code on the next write touching each row.

-- User
ALTER TABLE "users" ADD COLUMN "emailHash" TEXT;
CREATE UNIQUE INDEX "users_emailHash_key" ON "users"("emailHash");

-- LeadCapture
ALTER TABLE "lead_captures" ADD COLUMN "emailHash" TEXT;
CREATE UNIQUE INDEX "lead_captures_emailHash_key" ON "lead_captures"("emailHash");

-- Contact
ALTER TABLE "contacts" ADD COLUMN "emailHash" TEXT;
CREATE UNIQUE INDEX "contacts_emailHash_key" ON "contacts"("emailHash");
