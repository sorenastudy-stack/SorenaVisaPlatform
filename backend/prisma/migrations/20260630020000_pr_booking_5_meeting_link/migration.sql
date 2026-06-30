-- PR-BOOKING-5 — per-booking Jitsi meeting link on Consultation.
-- Additive + idempotent; applied to LOCAL only (db execute + migrate
-- resolve), per docs/known_issues.md. Existing rows backfill NULL.
ALTER TABLE "consultations"
  ADD COLUMN IF NOT EXISTS "meetingLink" TEXT;
