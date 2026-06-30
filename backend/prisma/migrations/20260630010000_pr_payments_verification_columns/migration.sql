-- Reconcile the `payments` table with schema.prisma (Phase 6.5 finance-
-- verification columns). These columns exist in schema.prisma and in
-- production, but were never captured in a migration file, so the local
-- DB drifted without them — which 500s the Stripe webhook's
-- `payment.create` (it writes verificationStatus). Additive + idempotent;
-- safe to run anywhere (IF NOT EXISTS guards make it a no-op where the
-- columns already exist, e.g. production). The PaymentVerificationStatus
-- enum already exists; guarded create for portability.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentVerificationStatus') THEN
    CREATE TYPE "PaymentVerificationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
  END IF;
END $$;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "verificationStatus" "PaymentVerificationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "verifiedById"       TEXT,
  ADD COLUMN IF NOT EXISTS "verifiedAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verificationNote"   TEXT,
  ADD COLUMN IF NOT EXISTS "receiptDocumentId"  TEXT;
