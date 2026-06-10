-- ─── Corrective migration: bring Railway DB up to schema.prisma ─────────
--
-- Railway's _prisma_migrations table marks earlier migrations as applied
-- but several columns those migrations were supposed to add are NOT in
-- the live DB (confirmed by /auth/register returning 500 "column
-- users.emailHash does not exist"). This migration is purely ADDITIVE
-- and IDEMPOTENT — every operation is wrapped in IF NOT EXISTS or
-- guarded by an information_schema lookup, so it succeeds whether
-- Railway already has the artefact or not. Local dev DBs that already
-- have everything will see this run as a sequence of no-ops.
--
-- No DROP. No data loss. No constraint tightening on existing data.

-- ─── 1. users.emailHash + unique index (PR-SEC2a — the immediate bug) ──
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_emailHash_key" ON "users"("emailHash");

-- ─── 2. lead_captures.emailHash + unique index ───────────────────────────
-- Same PR-SEC2a migration as users.emailHash; if one is missing, this is
-- almost certainly missing too.
ALTER TABLE "lead_captures" ADD COLUMN IF NOT EXISTS "emailHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "lead_captures_emailHash_key" ON "lead_captures"("emailHash");

-- ─── 3. contacts.emailHash + unique index ────────────────────────────────
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "emailHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_emailHash_key" ON "contacts"("emailHash");

-- ─── 4. users.* PR-CONSULT-4 staff profile columns (all nullable) ────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mobileNumber"       TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "countryOfResidence" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address"            TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emergencyContact"   TEXT;

-- ─── 5. users.specialisedCountries (PR-LIA-2 — text[] default '{}') ──────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "specialisedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ─── 6. users.canEditGlobalData (PR-CONSULT-1 — boolean default false) ───
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "canEditGlobalData" BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 7. users.googleId + unique index (Option C step 1) ──────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");

-- ─── 8. users.passwordHash → nullable (Option C step 1) ──────────────────
-- DROP NOT NULL is idempotent in PG 9.5+ but we guard anyway so the SQL
-- log doesn't show "ALTER TABLE" for a column that's already nullable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'users'
      AND column_name  = 'passwordHash'
      AND is_nullable  = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL';
  END IF;
END $$;

-- ─── 9. magic_link_tokens table (Option C step 1) ────────────────────────
CREATE TABLE IF NOT EXISTS "magic_link_tokens" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "magic_link_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "magic_link_tokens_userId_idx" ON "magic_link_tokens"("userId");

-- Foreign key — wrap in a DO block because there's no
-- ADD CONSTRAINT IF NOT EXISTS in Postgres; we check pg_constraint
-- to make the operation idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'magic_link_tokens_userId_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE "magic_link_tokens"
             ADD CONSTRAINT "magic_link_tokens_userId_fkey"
             FOREIGN KEY ("userId") REFERENCES "users"("id")
             ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
