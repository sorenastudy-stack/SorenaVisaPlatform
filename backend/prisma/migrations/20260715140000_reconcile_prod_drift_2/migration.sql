-- Reconcile prod schema drift (round 2).
--
-- `prisma migrate diff` (both directions) shows prod is a strict SUBSET of
-- schema.prisma: four additive gaps, nothing prod-only, no type/nullability/
-- default mismatches. This brings prod in line. Additive + idempotent, same
-- discipline as reconcile_prod_drift.sql — guarded CREATE/ADD, safe to re-run.
--
-- ⚠️ RUN IN AUTOCOMMIT (psql \i or `psql -f`, NOT `psql -1` / --single-transaction).
--    Section 1's `ALTER TYPE ... ADD VALUE` cannot run inside a transaction
--    block on PG < 12; autocommit runs each statement standalone and is safe on
--    every version. The new value is NOT used elsewhere in this file.
--
-- Duplicate-safety (section 4): refunds.stripeRefundId has 0 duplicates on prod
-- (the table is empty), so the UNIQUE index is safe to create.

-- ── 1. UserRole += CLIENT_CONSULTANT (autocommit; idempotent) ─────────────────
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CLIENT_CONSULTANT';

-- ── 2. cases.consultantId — column + index + FK (Phase-2a client-Consultant) ──
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "consultantId" TEXT;
CREATE INDEX IF NOT EXISTS "cases_consultantId_idx" ON "cases"("consultantId");
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_consultantId_fkey') THEN
    EXECUTE $sql$ALTER TABLE "cases" ADD CONSTRAINT "cases_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE$sql$;
  END IF;
END $do$;

-- ── 3. invoices receipt columns (6, all nullable) ────────────────────────────
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "receiptFileUrl"      TEXT,
  ADD COLUMN IF NOT EXISTS "receiptMethod"       TEXT,
  ADD COLUMN IF NOT EXISTS "receiptMimeType"     TEXT,
  ADD COLUMN IF NOT EXISTS "receiptOriginalName" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptSizeBytes"    INTEGER,
  ADD COLUMN IF NOT EXISTS "receiptUploadedAt"   TIMESTAMP(3);

-- ── 4. refunds.stripeRefundId UNIQUE index (0 duplicates verified) ───────────
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_stripeRefundId_key" ON "refunds"("stripeRefundId");
