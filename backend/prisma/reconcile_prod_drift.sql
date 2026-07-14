-- =====================================================================
-- PRODUCTION DRIFT RECONCILIATION — bring prod in line with schema.prisma
-- =====================================================================
-- Measured 2026-07-14 against prod (peaceful-imagination / Postgres): the 9
-- "LOCAL-only" migrations (20260629..20260702) were marked applied in prod's
-- _prisma_migrations history but never actually ran, so every object below is
-- currently MISSING. This re-applies them additively, using the FINAL
-- post-rename schema (staffId, staff_availability, staff_leave, Staff* enums)
-- so no RENAME is needed.
--
-- SAFETY:
--   • ADDITIVE + IDEMPOTENT ONLY — guarded CREATE TYPE, ADD COLUMN IF NOT
--     EXISTS, CREATE TABLE IF NOT EXISTS, CREATE [UNIQUE] INDEX IF NOT EXISTS,
--     guarded ADD CONSTRAINT, ADD VALUE IF NOT EXISTS. No DROP / RENAME /
--     RETYPE. Safe to re-run.
--   • Existing rows backfill to the column DEFAULT (NOT NULL cols) or NULL.
--     All the NOT-NULL columns use CONSTANT defaults, so PG 11+ applies them
--     as fast metadata-only changes (no full table rewrite / long lock).
--   • Every type / nullability / default / FK / index name matches
--     schema.prisma + the source migrations exactly.
--
-- ⚠️ RUN IN AUTOCOMMIT (psql \i or `psql -f`, NOT `psql -1` /
--    --single-transaction, and NOT bundled inside one BEGIN..COMMIT).
--    Section 5 (ALTER TYPE ... ADD VALUE) cannot run inside a transaction
--    block on PG < 12; autocommit runs each statement standalone and is safe
--    on every version.
-- =====================================================================


-- ── 1. ENUM TYPES ────────────────────────────────────────────────────
-- CREATE TYPE has no IF NOT EXISTS, so each is guarded to swallow a re-run.
DO $$ BEGIN
  CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'ADVISER', 'SUPPORT_CONSULTANT', 'ADMISSION_CONSULTANT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'WALLET');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "WalletTransactionType" AS ENUM (
    'REFUND_CANCEL_FULL', 'REFUND_CANCEL_LATE', 'REFUND_NO_SHOW',
    'SPEND_BOOKING', 'CASH_REDEMPTION', 'ADJUSTMENT'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StaffLeaveStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StaffLeaveKind" AS ENUM ('DAY_OFF');
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 2. COLUMNS on existing tables (enum-referencing cols come after §1) ──
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "languages"            TEXT[]               NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "timezone"             TEXT                 NOT NULL DEFAULT 'Pacific/Auckland',
  ADD COLUMN IF NOT EXISTS "bookableSessionTypes" "ConsultationType"[] NOT NULL DEFAULT ARRAY[]::"ConsultationType"[],
  ADD COLUMN IF NOT EXISTS "bookingActive"        BOOLEAN              NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "staffRole"             "StaffRole",
  ADD COLUMN IF NOT EXISTS "jobDescription"        TEXT,
  ADD COLUMN IF NOT EXISTS "jobDescriptionSetById" TEXT,
  ADD COLUMN IF NOT EXISTS "jobDescriptionSetAt"   TIMESTAMP(3);

ALTER TABLE "consultations"
  ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "scheduledEndAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bookingTimezone" TEXT,
  ADD COLUMN IF NOT EXISTS "holdExpiresAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "meetingLink"     TEXT,
  ADD COLUMN IF NOT EXISTS "paidWith"        "PaymentMethod";

ALTER TABLE "refunds"
  ADD COLUMN IF NOT EXISTS "consultationId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT;


-- ── 3. TABLES (final post-rename names) ──────────────────────────────
-- FK order: users already exists; wallet created before wallet_transaction.

-- 3a. staff_availability  (FK staffId → users)
CREATE TABLE IF NOT EXISTS "staff_availability" (
  "id"          TEXT NOT NULL,
  "staffId"     TEXT NOT NULL,
  "dayOfWeek"   INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute"   INTEGER NOT NULL,
  "timezone"    TEXT NOT NULL DEFAULT 'Pacific/Auckland',
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "setById"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "staff_availability_staffId_dayOfWeek_idx" ON "staff_availability"("staffId", "dayOfWeek");
CREATE INDEX IF NOT EXISTS "staff_availability_staffId_active_idx"    ON "staff_availability"("staffId", "active");
DO $$ BEGIN
  ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3b. staff_leave  (FK staffId → users)
CREATE TABLE IF NOT EXISTS "staff_leave" (
  "id"            TEXT NOT NULL,
  "staffId"       TEXT NOT NULL,
  "startDate"     TEXT NOT NULL,
  "endDate"       TEXT NOT NULL,
  "kind"          "StaffLeaveKind"   NOT NULL DEFAULT 'DAY_OFF',
  "status"        "StaffLeaveStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason"        TEXT,
  "requestedById" TEXT,
  "approvedById"  TEXT,
  "decidedAt"     TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_leave_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "staff_leave_staffId_status_idx" ON "staff_leave"("staffId", "status");
CREATE INDEX IF NOT EXISTS "staff_leave_status_idx"         ON "staff_leave"("status");
DO $$ BEGIN
  ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3c. staff_contract  (FK userId → users; userId unique)
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
CREATE UNIQUE INDEX IF NOT EXISTS "staff_contract_userId_key" ON "staff_contract"("userId");
DO $$ BEGIN
  ALTER TABLE "staff_contract" ADD CONSTRAINT "staff_contract_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3d. wallet  (FK userId → users; userId unique) — created BEFORE wallet_transaction
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

-- 3e. wallet_transaction  (FK walletId → wallet) + partial-unique refund guard
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
CREATE INDEX IF NOT EXISTS "wallet_transaction_walletId_createdAt_idx"    ON "wallet_transaction"("walletId", "createdAt");
CREATE INDEX IF NOT EXISTS "wallet_transaction_relatedConsultationId_idx" ON "wallet_transaction"("relatedConsultationId");
-- Double-credit guard: a consultation may be credited (any REFUND_* kind) at
-- most once. Partial unique index — not expressible in Prisma; lives in SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transaction_refund_once_idx"
  ON "wallet_transaction" ("relatedConsultationId")
  WHERE "type" IN ('REFUND_CANCEL_FULL', 'REFUND_CANCEL_LATE', 'REFUND_NO_SHOW')
    AND "relatedConsultationId" IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3f. policy_acceptance  (FK userId → users)
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
CREATE INDEX IF NOT EXISTS "policy_acceptance_userId_idx"         ON "policy_acceptance"("userId");
CREATE INDEX IF NOT EXISTS "policy_acceptance_consultationId_idx" ON "policy_acceptance"("consultationId");
DO $$ BEGIN
  ALTER TABLE "policy_acceptance" ADD CONSTRAINT "policy_acceptance_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 4. Consultations booking indexes (from booking_1; on existing table) ──
CREATE INDEX IF NOT EXISTS "consultations_assignedToId_scheduledAt_idx"
  ON "consultations" ("assignedToId", "scheduledAt");
-- Hard double-booking backstop: at most one active (BOOKED/CONFIRMED) row per
-- (adviser, slot). Partial unique — not expressible in Prisma; SQL-only.
CREATE UNIQUE INDEX IF NOT EXISTS "consultations_adviser_slot_active_unique"
  ON "consultations" ("assignedToId", "scheduledAt")
  WHERE "status" IN ('BOOKED', 'CONFIRMED') AND "scheduledAt" IS NOT NULL;


-- ── 5. ConsultationType enum values — MUST BE LAST, autocommit only ──────
-- (ALTER TYPE ADD VALUE can't run inside a transaction block on PG < 12. On
--  PG 12+ it's allowed, and safe here because the new values are not USED in
--  this file. Run in autocommit — see the header note.)
ALTER TYPE "ConsultationType" ADD VALUE IF NOT EXISTS 'FREE_15';
ALTER TYPE "ConsultationType" ADD VALUE IF NOT EXISTS 'GAP_CLOSING';
