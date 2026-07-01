-- PR-WALLET slice 1 — client store-credit wallet + immutable ledger + proof of
-- policy acceptance. Additive + idempotent, hand-authored per docs/known_issues.md
-- (applied via `prisma db execute` then `migrate resolve --applied`). No money
-- columns on existing tables are changed. ALL amounts are INTEGER cents.

-- ── Enum ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "WalletTransactionType" AS ENUM (
    'REFUND_CANCEL_FULL', 'REFUND_CANCEL_LATE', 'REFUND_NO_SHOW',
    'SPEND_BOOKING', 'CASH_REDEMPTION', 'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── wallet: one store-credit balance per client User ─────────────────────────
CREATE TABLE IF NOT EXISTS "wallet" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "balanceCents" INTEGER NOT NULL DEFAULT 0,
  "currency"     TEXT NOT NULL DEFAULT 'NZD',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_userId_key" ON "wallet"("userId");
DO $$ BEGIN
  ALTER TABLE "wallet" ADD CONSTRAINT "wallet_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── wallet_transaction: append-only ledger (source of truth) ─────────────────
CREATE TABLE IF NOT EXISTS "wallet_transaction" (
  "id"                    TEXT NOT NULL,
  "walletId"              TEXT NOT NULL,
  "amountCents"           INTEGER NOT NULL,
  "type"                  "WalletTransactionType" NOT NULL,
  "balanceAfterCents"     INTEGER NOT NULL,
  "reason"                TEXT,
  "relatedConsultationId" TEXT,
  "relatedPaymentId"      TEXT,
  "createdById"           TEXT NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_transaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "wallet_transaction_walletId_createdAt_idx" ON "wallet_transaction"("walletId", "createdAt");
CREATE INDEX IF NOT EXISTS "wallet_transaction_relatedConsultationId_idx" ON "wallet_transaction"("relatedConsultationId");
DO $$ BEGIN
  ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Double-credit guard: a consultation may be credited (any REFUND_* kind) at
-- most once. Partial unique index — not expressible in the Prisma schema, so
-- it lives here only (Prisma stays unaware; safe under the db-execute pattern).
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transaction_refund_once_idx"
  ON "wallet_transaction" ("relatedConsultationId")
  WHERE "type" IN ('REFUND_CANCEL_FULL', 'REFUND_CANCEL_LATE', 'REFUND_NO_SHOW')
    AND "relatedConsultationId" IS NOT NULL;

-- ── policy_acceptance: proof captured before a paid booking ──────────────────
CREATE TABLE IF NOT EXISTS "policy_acceptance" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "consultationId" TEXT,
  "policyVersion"  TEXT NOT NULL,
  "acceptedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress"      TEXT,
  "userAgent"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policy_acceptance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "policy_acceptance_userId_idx" ON "policy_acceptance"("userId");
CREATE INDEX IF NOT EXISTS "policy_acceptance_consultationId_idx" ON "policy_acceptance"("consultationId");
DO $$ BEGIN
  ALTER TABLE "policy_acceptance" ADD CONSTRAINT "policy_acceptance_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
