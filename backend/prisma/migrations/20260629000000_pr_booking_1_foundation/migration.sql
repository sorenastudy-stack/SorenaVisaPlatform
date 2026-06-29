-- PR-BOOKING-1 — native in-portal booking foundation.
--
-- All additive. No DROP, no rename, no retype, no NOT NULL on existing
-- columns. Authored by hand (not `migrate dev`) because this repo's
-- migration history can't replay cleanly on a shadow DB; applied to
-- LOCAL only. IF [NOT] EXISTS guards keep it idempotent/safe.

-- 1. New session types on the existing enum (keep ADMISSION, LIA).
--    ADD VALUE is non-destructive; values are not used in this migration.
ALTER TYPE "ConsultationType" ADD VALUE IF NOT EXISTS 'FREE_15';
ALTER TYPE "ConsultationType" ADD VALUE IF NOT EXISTS 'GAP_CLOSING';

-- 2. Extend Consultation with native scheduling fields (all nullable).
ALTER TABLE "consultations"
  ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "scheduledEndAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bookingTimezone" TEXT,
  ADD COLUMN IF NOT EXISTS "holdExpiresAt"   TIMESTAMP(3);

-- 3. Busy-interval lookup index for the slot engine.
CREATE INDEX IF NOT EXISTS "consultations_assignedToId_scheduledAt_idx"
  ON "consultations" ("assignedToId", "scheduledAt");

-- 4. New AdviserAvailability table (OWNER-set weekly working hours).
CREATE TABLE IF NOT EXISTS "adviser_availability" (
  "id"          TEXT NOT NULL,
  "adviserId"   TEXT NOT NULL,
  "dayOfWeek"   INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute"   INTEGER NOT NULL,
  "timezone"    TEXT NOT NULL DEFAULT 'Pacific/Auckland',
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "setById"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adviser_availability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "adviser_availability_adviserId_dayOfWeek_idx"
  ON "adviser_availability" ("adviserId", "dayOfWeek");
CREATE INDEX IF NOT EXISTS "adviser_availability_adviserId_active_idx"
  ON "adviser_availability" ("adviserId", "active");

-- FK → users(id), cascade on adviser delete. Guarded so re-runs no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'adviser_availability_adviserId_fkey'
  ) THEN
    ALTER TABLE "adviser_availability"
      ADD CONSTRAINT "adviser_availability_adviserId_fkey"
      FOREIGN KEY ("adviserId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Partial UNIQUE index — the hard double-booking backstop. Only active
--    (BOOKED/CONFIRMED) scheduled rows are constrained; NULL scheduledAt
--    and cancelled/completed/pending rows are excluded. Prisma cannot
--    express a partial unique index, so it lives here as raw SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "consultations_adviser_slot_active_unique"
  ON "consultations" ("assignedToId", "scheduledAt")
  WHERE "status" IN ('BOOKED', 'CONFIRMED') AND "scheduledAt" IS NOT NULL;
