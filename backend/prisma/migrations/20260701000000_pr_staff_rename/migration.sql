-- PR-STAFF-RENAME — rename the umbrella booking "adviser" concept to "staff",
-- and add the descriptive StaffRole.
--
-- DATA-PRESERVING: every table/column/enum/index/constraint is RENAMED in
-- place (no DROP/CREATE), so existing rows are kept. Hand-authored + guarded
-- per docs/known_issues.md (applied via `prisma db execute`, recorded with
-- `migrate resolve --applied`). Safe to re-run: each rename is wrapped in an
-- existence check.

-- ── 1. StaffRole enum + nullable column on users + backfill from role ────────
DO $$ BEGIN
  CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'ADVISER', 'SUPPORT_CONSULTANT', 'ADMISSION_CONSULTANT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "staffRole" "StaffRole";

-- Backfill only rows not yet set. Non-staff roles (LEAD/STUDENT/AGENT/SALES/
-- OPERATIONS/FINANCE) intentionally map to NULL.
UPDATE "users" SET "staffRole" = (CASE "role"::text
  WHEN 'LIA'         THEN 'ADVISER'
  WHEN 'ADMIN'       THEN 'ADMIN'
  WHEN 'OWNER'       THEN 'ADMIN'
  WHEN 'SUPER_ADMIN' THEN 'ADMIN'
  WHEN 'SUPPORT'     THEN 'SUPPORT_CONSULTANT'
  WHEN 'CONSULTANT'  THEN 'ADMISSION_CONSULTANT'
  ELSE NULL END)::"StaffRole"
WHERE "staffRole" IS NULL;

-- ── 2. adviser_availability → staff_availability (table, column, keys, idx) ──
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'adviser_availability') THEN
    ALTER TABLE "adviser_availability" RENAME COLUMN "adviserId" TO "staffId";
    ALTER TABLE "adviser_availability" RENAME TO "staff_availability";
    ALTER TABLE "staff_availability" RENAME CONSTRAINT "adviser_availability_pkey" TO "staff_availability_pkey";
    ALTER TABLE "staff_availability" RENAME CONSTRAINT "adviser_availability_adviserId_fkey" TO "staff_availability_staffId_fkey";
    ALTER INDEX "adviser_availability_adviserId_active_idx"   RENAME TO "staff_availability_staffId_active_idx";
    ALTER INDEX "adviser_availability_adviserId_dayOfWeek_idx" RENAME TO "staff_availability_staffId_dayOfWeek_idx";
  END IF;
END $$;

-- ── 3. adviser_leave → staff_leave (table, column, keys, idx) ────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'adviser_leave') THEN
    ALTER TABLE "adviser_leave" RENAME COLUMN "adviserId" TO "staffId";
    ALTER TABLE "adviser_leave" RENAME TO "staff_leave";
    ALTER TABLE "staff_leave" RENAME CONSTRAINT "adviser_leave_pkey" TO "staff_leave_pkey";
    ALTER TABLE "staff_leave" RENAME CONSTRAINT "adviser_leave_adviserId_fkey" TO "staff_leave_staffId_fkey";
    ALTER INDEX "adviser_leave_adviserId_status_idx" RENAME TO "staff_leave_staffId_status_idx";
    ALTER INDEX "adviser_leave_status_idx"            RENAME TO "staff_leave_status_idx";
  END IF;
END $$;

-- ── 4. Rename the leave enum types ───────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdviserLeaveStatus') THEN
    ALTER TYPE "AdviserLeaveStatus" RENAME TO "StaffLeaveStatus";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdviserLeaveKind') THEN
    ALTER TYPE "AdviserLeaveKind" RENAME TO "StaffLeaveKind";
  END IF;
END $$;
