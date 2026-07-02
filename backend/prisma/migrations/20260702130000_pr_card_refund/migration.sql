-- PR-CARD-REFUND — real Stripe card refunds (exceptional cash-out).
-- Additive + idempotent, hand-authored per docs/known_issues.md (applied via
-- `prisma db execute` then `migrate resolve --applied`). No existing data
-- rewritten: new columns are nullable and backfill as NULL on legacy rows.

-- Link the booking + record the real Stripe refund id.
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "consultationId" TEXT;
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT;

-- Audit / idempotency: a Stripe refund id maps to at most one row.
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_stripeRefundId_key"
  ON "refunds" ("stripeRefundId");

-- Real-money double-issue guard: at most ONE live (PENDING or COMPLETED)
-- refund per payment. A concurrent/retried issue hits this -> P2002 -> 409.
-- FAILED rows are excluded so a genuinely failed refund can be retried; the
-- legacy PENDING_STRIPE_INTEGRATION placeholder is excluded so dormant rows
-- from the old owner-approval executor never block a real refund.
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_payment_live_once_idx"
  ON "refunds" ("paymentId")
  WHERE "status" IN ('PENDING', 'COMPLETED');
