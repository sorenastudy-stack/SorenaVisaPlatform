-- PR-LIA-9 — Visa expiry reminder ledger.
--
-- 1. New enum: VisaExpiryReminderRecipient (LIA | CLIENT | OWNER).
-- 2. New table: visa_expiry_reminders_sent — one row per dispatched
--    (or attempted) expiry-reminder email. Uniqueness on
--    (visaId, thresholdDays, recipient) makes re-running the daily
--    sweep idempotent.
-- 3. Indexes:
--    * UNIQUE (visaId, thresholdDays, recipient) — the dedup key
--    * (visaId, sentAt)   — "all reminders for this visa, in order"
--    * (sentAt)           — operational sweep stats over time
-- 4. FK:
--    * visaId → visas.id  ON DELETE CASCADE  (only triggers if the
--      Visa row itself is hard-deleted; revertVisaRecord deletes
--      the visa row and the cascade carries the reminders. That
--      matches the spec: "do not delete reminder records on revert"
--      because revert is itself a destructive un-issue — there is
--      no "soft revert" path that we'd want to preserve reminders
--      across.)

CREATE TYPE "VisaExpiryReminderRecipient" AS ENUM ('LIA', 'CLIENT', 'OWNER');

CREATE TABLE "visa_expiry_reminders_sent" (
  "id"                  TEXT                          NOT NULL,
  "visaId"              TEXT                          NOT NULL,
  "thresholdDays"       INTEGER                       NOT NULL,
  "recipient"           "VisaExpiryReminderRecipient" NOT NULL,
  "recipientUserId"     TEXT,
  "sentAt"              TIMESTAMP(3)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailDeliveryStatus" TEXT                          NOT NULL DEFAULT 'PENDING',
  "emailErrorMessage"   TEXT,

  CONSTRAINT "visa_expiry_reminders_sent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_visa_threshold_recipient"
  ON "visa_expiry_reminders_sent"("visaId", "thresholdDays", "recipient");

CREATE INDEX "visa_expiry_reminders_sent_visaId_sentAt_idx"
  ON "visa_expiry_reminders_sent"("visaId", "sentAt");

CREATE INDEX "visa_expiry_reminders_sent_sentAt_idx"
  ON "visa_expiry_reminders_sent"("sentAt");

ALTER TABLE "visa_expiry_reminders_sent"
  ADD CONSTRAINT "visa_expiry_reminders_sent_visaId_fkey"
  FOREIGN KEY ("visaId") REFERENCES "visas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
