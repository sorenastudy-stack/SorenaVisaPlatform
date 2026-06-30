-- PR-BOOKING-ADMIN-B — adviser leave / time-off (Stage B, slice 1).
--
-- Additive + idempotent, hand-authored per docs/known_issues.md (the local
-- migration history is drifted, so we apply via `prisma db execute` and then
-- `migrate resolve --applied`, never `migrate dev`/`db push`). Safe to re-run:
-- every statement is guarded (CREATE TYPE has no IF NOT EXISTS, so the enums
-- use a DO block that swallows duplicate_object).

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "AdviserLeaveStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AdviserLeaveKind" AS ENUM ('DAY_OFF');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "adviser_leave" (
  "id"            TEXT NOT NULL,
  "adviserId"     TEXT NOT NULL,
  "startDate"     TEXT NOT NULL,
  "endDate"       TEXT NOT NULL,
  "kind"          "AdviserLeaveKind"   NOT NULL DEFAULT 'DAY_OFF',
  "status"        "AdviserLeaveStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason"        TEXT,
  "requestedById" TEXT,
  "approvedById"  TEXT,
  "decidedAt"     TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adviser_leave_pkey" PRIMARY KEY ("id")
);

-- ── FK → users (cascade on adviser delete); guarded for idempotency ──────────
DO $$ BEGIN
  ALTER TABLE "adviser_leave"
    ADD CONSTRAINT "adviser_leave_adviserId_fkey"
    FOREIGN KEY ("adviserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "adviser_leave_adviserId_status_idx" ON "adviser_leave"("adviserId", "status");
CREATE INDEX IF NOT EXISTS "adviser_leave_status_idx" ON "adviser_leave"("status");
