-- ─── Add email + tokenHash uniqueness/index to magic_link_tokens ────────
--
-- Schema lift to support the magic-link login service. The table itself
-- was created in earlier migrations (option_c_passwordless_auth_prep,
-- reconciled by reconcile_railway_schema_drift). This migration is
-- additive ONLY:
--
--   1. email  TEXT NOT NULL  — lowercased target email at token-create
--      time. The DEFAULT '' is a transitional safeguard so the ADD
--      COLUMN succeeds on any existing rows (the table is expected
--      to be empty in prod; this is belt-and-braces). The default is
--      dropped immediately after.
--
--   2. UNIQUE(tokenHash) — primary verify-path lookup. UNIQUE because
--      a hash collision would be a security bug, not a data problem.
--
--   3. INDEX(tokenHash) — explicit per the build contract. Redundant
--      with the unique constraint's index, kept for completeness.
--
-- No DROP. No data loss.

-- 1. ─── email column ───────────────────────────────────────────────────
ALTER TABLE "magic_link_tokens" ADD COLUMN IF NOT EXISTS "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "magic_link_tokens" ALTER COLUMN "email" DROP DEFAULT;

-- 2. ─── UNIQUE(tokenHash) ──────────────────────────────────────────────
DO $do$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'magic_link_tokens_tokenHash_key'
  ) THEN
    EXECUTE 'ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_tokenHash_key" UNIQUE ("tokenHash")';
  END IF;
END $do$;

-- 3. ─── INDEX(tokenHash) ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "magic_link_tokens_tokenHash_idx" ON "magic_link_tokens"("tokenHash");
