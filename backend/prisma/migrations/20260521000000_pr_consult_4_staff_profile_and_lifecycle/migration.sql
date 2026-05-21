-- PR-CONSULT-4 — Staff profile fields, audit log snapshots,
-- HARD_DELETE_STAFF approval action type, SALES + test-user cleanup.
--
-- Hand-written, applied via `prisma migrate deploy` — matches the
-- convention every prior staff-tier PR has used.

-- 1. Staff profile fields on users. All nullable because existing
--    rows pre-date this PR. Required-at-create is enforced by the
--    DTO layer, not the column. The three sensitive columns
--    (mobile, address, emergencyContact) store base64-encoded
--    AES-256-GCM ciphertext via CryptoService. countryOfResidence
--    stays plain ISO 3166-1 alpha-2 so it can be filtered /
--    aggregated without decrypt cost.
ALTER TABLE "users" ADD COLUMN "mobileNumber"       TEXT;
ALTER TABLE "users" ADD COLUMN "countryOfResidence" TEXT;
ALTER TABLE "users" ADD COLUMN "address"            TEXT;
ALTER TABLE "users" ADD COLUMN "emergencyContact"   TEXT;

-- 2. Audit log actor snapshot columns. Populated either at write-
--    time (new code paths from this PR) or at delete-time (the
--    hard-delete service snapshots a user's rows just before the
--    User row is removed). Old rows leave both null; the summary
--    helper falls back to "(Removed user)".
ALTER TABLE "audit_logs" ADD COLUMN "actorNameSnapshot" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "actorRoleSnapshot" TEXT;

-- 3. New HARD_DELETE_STAFF action type. Postgres 12+ supports
--    ALTER TYPE ADD VALUE inside a transaction as long as the new
--    value isn't used in the same transaction — which it isn't.
ALTER TYPE "OwnerApprovalActionType" ADD VALUE 'HARD_DELETE_STAFF';

-- 4. SALES role normalisation. Any user still on SALES is moved
--    to CONSULTANT for historical continuity and archived (their
--    StaffActiveStatus.isActive set to false). We use a CTE to
--    capture the user ids before flipping the role so the audit
--    rows are tied to the right user. The sentinel actor is the
--    oldest OWNER on the platform; if no OWNER exists yet, the
--    audit row is written with userId NULL so the migration still
--    completes (audit_logs.userId is nullable).
DO $$
DECLARE
  owner_id TEXT;
  sales_id TEXT;
BEGIN
  SELECT id INTO owner_id
    FROM "users"
   WHERE role = 'OWNER'
   ORDER BY "createdAt" ASC
   LIMIT 1;

  FOR sales_id IN
    SELECT id FROM "users" WHERE role = 'SALES'
  LOOP
    -- Re-stamp role.
    UPDATE "users" SET role = 'CONSULTANT' WHERE id = sales_id;

    -- Archive (insert or update the active-status row).
    INSERT INTO "staff_active_status" ("userId", "isActive", "deactivatedAt", "deactivatedById")
    VALUES (sales_id, FALSE, NOW(), owner_id)
    ON CONFLICT ("userId") DO UPDATE
      SET "isActive"        = FALSE,
          "deactivatedAt"   = NOW(),
          "deactivatedById" = owner_id;

    -- Audit. Snapshot columns are populated so the row survives
    -- a future hard-delete of the actor.
    INSERT INTO "audit_logs" (
      "id", "userId", "action", "eventType",
      "entityType", "entityId", "newValue",
      "actorNameSnapshot", "actorRoleSnapshot", "createdAt"
    )
    VALUES (
      'audit_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20),
      owner_id,
      'STAFF_ROLE_NORMALIZED_FROM_SALES',
      'STAFF_ROLE_NORMALIZED_FROM_SALES',
      'User',
      sales_id,
      '{"previousRole":"SALES","newRole":"CONSULTANT"}'::jsonb,
      (SELECT name FROM "users" WHERE id = owner_id),
      'OWNER',
      NOW()
    );
  END LOOP;
END $$;

-- 5. Archive the four named test users by email. INSERT ... ON
--    CONFLICT pattern so this is idempotent against any rerun and
--    safe when the user doesn't exist (the inner SELECT just
--    yields zero rows). `deactivatedById` is NULL because there's
--    no obvious actor for these cleanups — they're system-driven.
INSERT INTO "staff_active_status" ("userId", "isActive", "deactivatedAt", "deactivatedById")
SELECT id, FALSE, NOW(), NULL
  FROM "users"
 WHERE email IN (
   'test@sorenatest.com',
   'admin@sorenatest.com',
   'sales@sorenatest.com',
   'support@sorenatest.com'
 )
ON CONFLICT ("userId") DO UPDATE
  SET "isActive"      = FALSE,
      "deactivatedAt" = COALESCE("staff_active_status"."deactivatedAt", NOW());

-- 6. SALES enum value is intentionally NOT dropped. Postgres
--    doesn't support ALTER TYPE ... DROP VALUE and the
--    rename-and-recreate dance is risky for an enum that's
--    referenced by every row in `users` already. The value is
--    "deprecated" — backend DTOs reject SALES at request time;
--    the User.role column default still references SALES because
--    Prisma's `@default(SALES)` predates this PR, but no live
--    write path uses the default. A follow-up PR can flip the
--    default to CONSULTANT once we're confident no caller relies
--    on the old behaviour.
COMMENT ON TYPE "UserRole" IS
  'SALES is deprecated as of PR-CONSULT-4. Existing rows have been migrated to CONSULTANT + archived; new writes must use one of the other roles. The enum value is retained because Postgres does not support DROP VALUE; future PRs may rebuild the enum.';
