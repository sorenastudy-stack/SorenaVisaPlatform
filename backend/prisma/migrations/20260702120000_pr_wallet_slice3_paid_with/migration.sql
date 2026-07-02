-- PR-WALLET slice 3 (a) — settlement-method marker on consultations.
-- Additive + idempotent, hand-authored per docs/known_issues.md (applied via
-- `prisma db execute` then `migrate resolve --applied`). No existing data is
-- rewritten: the column is nullable, so every current row backfills as NULL
-- (correct — legacy/free rows have no recorded method).

-- ── Enum: how a paid booking was settled ─────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'WALLET');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── consultations.paidWith (nullable) ────────────────────────────────────────
ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "paidWith" "PaymentMethod";
