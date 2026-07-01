-- PR-STAFF-HR (Phase 3) — staff HR self-service: employment contract + job description.
--
-- Additive + idempotent, hand-authored per docs/known_issues.md (applied via
-- `prisma db execute` then `migrate resolve --applied`, never `migrate dev`).
-- Data-preserving: only a new table + three nullable columns on users.

-- ── staff_contract: one current contract PDF per staff member ────────────────
CREATE TABLE IF NOT EXISTS "staff_contract" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "fileUrl"      TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "sizeBytes"    INTEGER NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "uploadedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_contract_pkey" PRIMARY KEY ("id")
);

-- One-to-one with users (unique userId → replace-on-reupload).
CREATE UNIQUE INDEX IF NOT EXISTS "staff_contract_userId_key" ON "staff_contract"("userId");

-- FK → users (cascade on staff delete); guarded for idempotency.
DO $$ BEGIN
  ALTER TABLE "staff_contract"
    ADD CONSTRAINT "staff_contract_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── users: admin-set job description (plain text) + who/when ─────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "jobDescription"        TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "jobDescriptionSetById" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "jobDescriptionSetAt"   TIMESTAMP(3);
