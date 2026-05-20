-- PR-CONSULT-1 — Staff roles + load-based auto-allocation + owner-approval queue.
--
-- Foundation PR (no consultant UI yet — lands in PR-CONSULT-2).
--
-- What this migration does:
--   1. Adds OWNER, CONSULTANT, FINANCE to the existing UserRole enum
--      (3 ALTER TYPE ADD VALUE statements — Postgres 12+ allows these
--      inside a transaction since the new values aren't used in the
--      same transaction).
--   2. Creates VisaCaseRoleSlot / OwnerApprovalStatus /
--      OwnerApprovalActionType enums.
--   3. Creates visa_case_assignments, owner_approval_requests,
--      staff_active_status, refunds, platform_settings tables.
--
-- NO ROLE BACKFILL — per spec, existing staff users keep their
-- current role. The OWNER role must be set manually on a single user
-- before the approval-queue UI can be used; see the handover doc and
-- the commented snippet at the bottom of this file.
--
-- Hand-written, applied via `prisma migrate deploy` — same convention
-- as every prior PR.

-- 1. Extend the existing enum. Each statement is a separate
--    transaction-safe call in PG 12+.
ALTER TYPE "UserRole" ADD VALUE 'OWNER';
ALTER TYPE "UserRole" ADD VALUE 'CONSULTANT';
ALTER TYPE "UserRole" ADD VALUE 'FINANCE';

-- 2. New enums.
CREATE TYPE "VisaCaseRoleSlot" AS ENUM (
  'LIA',
  'CONSULTANT',
  'SUPPORT',
  'FINANCE'
);

CREATE TYPE "OwnerApprovalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'EXECUTED',
  'EXECUTION_FAILED'
);

CREATE TYPE "OwnerApprovalActionType" AS ENUM (
  'CREATE_STAFF_USER',
  'CHANGE_STAFF_ROLE',
  'DEACTIVATE_STAFF',
  'DELETE_CASE',
  'DELETE_STUDENT',
  'ISSUE_REFUND',
  'CHANGE_PLATFORM_SETTING'
);

-- 3. visa_case_assignments — one row per (case, roleSlot, period).
--    Active rows have unassignedAt IS NULL; the composite index
--    optimises for "current assignee of slot X on case Y" lookups.
CREATE TABLE "visa_case_assignments" (
  "id"             TEXT NOT NULL,
  "caseId"         TEXT NOT NULL,
  "staffId"        TEXT NOT NULL,
  "roleSlot"       "VisaCaseRoleSlot" NOT NULL,
  "assignedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedById"   TEXT NOT NULL,
  "unassignedAt"   TIMESTAMP(3),
  "unassignedById" TEXT,
  CONSTRAINT "visa_case_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_case_assignments_caseId_roleSlot_unassignedAt_idx"
  ON "visa_case_assignments"("caseId", "roleSlot", "unassignedAt");
CREATE INDEX "visa_case_assignments_staffId_unassignedAt_idx"
  ON "visa_case_assignments"("staffId", "unassignedAt");

ALTER TABLE "visa_case_assignments"
  ADD CONSTRAINT "visa_case_assignments_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "visa_cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_case_assignments"
  ADD CONSTRAINT "visa_case_assignments_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "visa_case_assignments"
  ADD CONSTRAINT "visa_case_assignments_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- 4. owner_approval_requests — destructive-action queue.
--    payload / reason / decisionNote are encrypted TEXT (CryptoService
--    base64 envelope).
CREATE TABLE "owner_approval_requests" (
  "id"             TEXT NOT NULL,
  "requestedById"  TEXT NOT NULL,
  "actionType"     "OwnerApprovalActionType" NOT NULL,
  "payload"        TEXT NOT NULL,
  "reason"         TEXT,
  "status"         "OwnerApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "decidedById"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "decisionNote"   TEXT,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "executedAt"     TIMESTAMP(3),
  "executionError" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "owner_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "owner_approval_requests_status_expiresAt_idx"
  ON "owner_approval_requests"("status", "expiresAt");
CREATE INDEX "owner_approval_requests_requestedById_createdAt_idx"
  ON "owner_approval_requests"("requestedById", "createdAt");

ALTER TABLE "owner_approval_requests"
  ADD CONSTRAINT "owner_approval_requests_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "owner_approval_requests"
  ADD CONSTRAINT "owner_approval_requests_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- 5. staff_active_status — soft-disable flag for staff users.
CREATE TABLE "staff_active_status" (
  "userId"           TEXT NOT NULL,
  "isActive"         BOOLEAN NOT NULL DEFAULT TRUE,
  "deactivatedAt"    TIMESTAMP(3),
  "deactivatedById"  TEXT,
  CONSTRAINT "staff_active_status_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "staff_active_status"
  ADD CONSTRAINT "staff_active_status_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. refunds — placeholder until Stripe is wired.
CREATE TABLE "refunds" (
  "id"          TEXT NOT NULL,
  "paymentId"   TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "reason"      TEXT,
  "status"      TEXT NOT NULL DEFAULT 'PENDING_STRIPE_INTEGRATION',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- 7. platform_settings — generic key-value store. value encrypted.
CREATE TABLE "platform_settings" (
  "key"         TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT NOT NULL,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- Manual step after migration deploys — promote one User to OWNER
-- so the approval queue has someone who can approve / reject
-- requests. Without this, SUPER_ADMIN can still enqueue but
-- nothing will ever execute:
--
-- UPDATE "users" SET role = 'OWNER' WHERE email = 'owner@sorenastudy.com';
