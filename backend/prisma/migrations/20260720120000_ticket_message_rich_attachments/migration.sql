-- PR-TICKETS-RICH — rich-text + attachments on staff/client ticket messages.
--
-- Additive only: two nullable/defaulted columns on an existing table. No data
-- backfill, no lock on existing rows, instantly reversible (DROP COLUMN).
--   * bodyIsHtml — render flag; existing rows default to false (plain text).
--   * attachments — JSONB array of { key, name, mime, size }; NULL = none.
ALTER TABLE "visa_support_ticket_messages" ADD COLUMN "bodyIsHtml" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "visa_support_ticket_messages" ADD COLUMN "attachments" JSONB;
