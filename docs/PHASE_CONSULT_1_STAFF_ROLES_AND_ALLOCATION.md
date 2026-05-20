# PR-CONSULT-1 — Staff roles, load-based auto-allocation, owner-approval queue

Handover for the staff-roles foundation that landed on `main` as commit `afb00ea`.

## 1. What this PR does

The platform now has a tiered staff role system, a per-case-and-slot assignment table, load-based auto-allocation when a `VisaCase` is first created, manual reassignment for the admin tier, and an OWNER-approval queue that gates SUPER_ADMIN's destructive actions. There is **no consultant-facing UI yet** — that lands in PR-CONSULT-2. This PR ships only the schema, services, role guards, and the small backend wiring that surfaces the assigned LIA + CONSULTANT names on the student dashboard.

The role matrix is locked. SUPER_ADMIN can no longer directly create staff, change roles, deactivate staff, delete cases or students, issue refunds, or change platform settings — those flow through the OwnerApprovalRequest queue. ADMIN can do none of those things. OWNER is the only role that can approve queued requests.

## 2. Files changed

Backend (new module under `backend/src/staff/`):
- `staff.module.ts` — root bundle, imported once by `AppModule`.
- `roles/` — `staff-roles.guard.ts`, `staff-roles.decorator.ts`, `staff-roles.module.ts`.
- `assignments/` — `assignments.module.ts`, `assignments.service.ts`, `assignments.controller.ts`, `dto/assignments.dto.ts`, `guards/assignments-rate-limit.guards.ts`.
- `owner-approval/` — `owner-approval.module.ts`, `owner-approval.service.ts`, `owner-approval.controller.ts`, `dto/owner-approval.dto.ts`, `guards/owner-approval-rate-limit.guards.ts`.
- `users/` — `staff-users.module.ts`, `staff-users.service.ts`, `staff-users.controller.ts`, `dto/staff-users.dto.ts`.

Backend (existing):
- `prisma/schema.prisma` — added 3 enum values to `UserRole`, 3 new enums, 5 new models, back-relations on `User` and `VisaCase`.
- `prisma/migrations/20260520225802_pr_consult_1_staff_roles_and_allocation/migration.sql` — hand-written DDL with a commented manual OWNER-promotion snippet at the bottom.
- `app.module.ts` — registered `StaffModule`.
- `students/dashboard/dashboard.module.ts` — imports `AssignmentsModule`.
- `students/dashboard/dashboard.service.ts` — injects `AssignmentsService`, auto-allocates the four slots when a `VisaCase` is freshly created, surfaces `assignedLia` + `assignedConsultant` on the dashboard's `case` block.

Frontend (existing):
- `src/components/dashboard/CaseStatusCard.tsx` — renders the two assignee rows under the status badge.
- `src/app/student/dashboard/page.tsx` — extended the payload type and wired props through to `CaseStatusCard`.
- `src/i18n/messages/{en,fa}.json` — 3 new keys under `case.*`.

## 3. Schema added

```prisma
// Enum additions to the existing UserRole enum.
// Existing values (SUPER_ADMIN, ADMIN, SALES, OPERATIONS, LIA, SUPPORT, STUDENT, AGENT) kept verbatim.
enum UserRole { ... + OWNER + CONSULTANT + FINANCE }

enum VisaCaseRoleSlot   { LIA, CONSULTANT, SUPPORT, FINANCE }
enum OwnerApprovalStatus { PENDING, APPROVED, REJECTED, EXPIRED, EXECUTED, EXECUTION_FAILED }
enum OwnerApprovalActionType {
  CREATE_STAFF_USER, CHANGE_STAFF_ROLE, DEACTIVATE_STAFF,
  DELETE_CASE, DELETE_STUDENT, ISSUE_REFUND, CHANGE_PLATFORM_SETTING
}

model VisaCaseAssignment {
  id, caseId, staffId, roleSlot, assignedAt, assignedById,
  unassignedAt?, unassignedById?
  @@index([caseId, roleSlot, unassignedAt])
  @@index([staffId, unassignedAt])
}

model OwnerApprovalRequest {
  id, requestedById, actionType,
  payload (encrypted), reason? (encrypted),
  status, decidedById?, decidedAt?, decisionNote? (encrypted),
  expiresAt, executedAt?, executionError?,
  createdAt, updatedAt
}

model StaffActiveStatus {
  userId @id, isActive, deactivatedAt?, deactivatedById?
}

model Refund {
  id, paymentId, amountCents, reason?, status (default 'PENDING_STRIPE_INTEGRATION'),
  createdAt, createdById
}

model PlatformSetting {
  key @id, value (encrypted), updatedAt, updatedById
}
```

FK rules: case → assignment cascades; staff → assignment NO ACTION (deleted staff blocks the assignment, surfaces the issue rather than silently rewriting history); user → staffActiveStatus cascades. `OwnerApprovalRequest` payload / reason / decisionNote and `PlatformSetting.value` are stored as base64-encoded AES-256-GCM ciphertext via the existing `CryptoService`.

### Manual OWNER promotion (run once after migration)

The migration deliberately doesn't auto-promote anyone to OWNER. Run this manually after the deploy:

```sql
UPDATE "users" SET role = 'OWNER' WHERE email = 'owner@sorenastudy.com';
```

Without an OWNER user the approval queue accepts enqueued requests but nothing will ever execute — every SUPER_ADMIN action stays PENDING until an OWNER exists.

## 4. Role matrix (locked)

| Action | OWNER | SUPER_ADMIN | ADMIN | LIA/CONSULTANT/SUPPORT/FINANCE |
|---|---|---|---|---|
| View all cases | ✅ | ✅ | ✅ | Own assignments only |
| Create case | ✅ | ✅ | ✅ | ❌ |
| Reassign case slot | ✅ | ✅ | ✅ | ❌ |
| Trigger auto-allocation | ✅ | ✅ | ✅ | ❌ |
| View all staff | ✅ | ✅ | ✅ | ❌ |
| Create staff user | ✅ inline | ✅ queue | ❌ | ❌ |
| Change staff role | ✅ inline | ✅ queue | ❌ | ❌ |
| Deactivate staff | ✅ inline | ✅ queue | ❌ | ❌ |
| Reactivate staff | ✅ inline | ✅ inline | ❌ | ❌ |
| Delete case | ✅ inline | ✅ queue | ❌ | ❌ |
| Delete student | ✅ inline | ✅ queue | ❌ | ❌ |
| Issue refund | ✅ inline | ✅ queue | ❌ | ❌ |
| Change platform setting | ✅ inline | ✅ queue | ❌ | ❌ |
| Approve/reject queue | ✅ | ❌ | ❌ | ❌ |

"queue" = `requireOwnerOrEnqueue` returns `{ status: 'PENDING_OWNER_APPROVAL', requestId }`. "inline" = executes immediately.

### Owner-only action types

The seven values in `OwnerApprovalActionType`:

- `CREATE_STAFF_USER`
- `CHANGE_STAFF_ROLE`
- `DEACTIVATE_STAFF`
- `DELETE_CASE`
- `DELETE_STUDENT`
- `ISSUE_REFUND`
- `CHANGE_PLATFORM_SETTING`

Adding a new owner-only action means: extend the enum, write an executor branch in `OwnerApprovalService.executeApprovedAction`, and route the endpoint through `requireOwnerOrEnqueue` in the relevant controller.

## 5. Services + endpoints

All routes are gated by `JwtAuthGuard + StaffRolesGuard` with role-specific `@StaffRoles(...)` decorators. The new guard adds a `StaffActiveStatus.isActive` check on top of the existing role check.

**Assignments (`/api/staff/assignments`):**
- `POST /auto-allocate` — admin tier (OWNER/SUPER_ADMIN/ADMIN). Body `{ caseId, roleSlot }`. Picks fewest-loaded staff, tie-break by oldest `createdAt`. Rate-limited 30/h.
- `POST /manual-assign` — admin tier. Body `{ caseId, roleSlot, staffId }`. Closes prior active assignment + opens new one in one transaction. Rate-limited 60/h.
- `GET /case/:caseId` — any active staff. Returns `{ LIA, CONSULTANT, SUPPORT, FINANCE }` with assignee names or null.
- `GET /workload` — any staff; admin tier can pass `?staffId=` to see anyone's.
- `GET /available-staff?roleSlot=LIA` — admin tier. Lists active staff of the matching role with their open-assignment count.

**Owner approval (`/api/staff/owner-approval`):**
- `POST /` — SUPER_ADMIN only. Body `{ actionType, payload, reason? }`. Rate-limited 50/h.
- `GET /pending` — OWNER only. Runs on-read expiry sweep, returns decrypted-payload rows.
- `GET /mine` — SUPER_ADMIN or OWNER. Returns the caller's own requests.
- `POST /:id/approve` — OWNER only. Approves, executes the action immediately, transitions to EXECUTED or EXECUTION_FAILED based on outcome. Rate-limited 100/h.
- `POST /:id/reject` — OWNER only. Rate-limited 100/h.

**Staff users (`/api/staff/users`):**
- `GET /` — admin tier.
- `GET /:id` — admin tier.
- `POST /` — OWNER inline (returns temp password in response), SUPER_ADMIN enqueues, ADMIN 403.
- `PATCH /:id/role` — OWNER inline, SUPER_ADMIN enqueues, ADMIN 403.
- `POST /:id/deactivate` — OWNER inline, SUPER_ADMIN enqueues, ADMIN 403. Cascade-closes the user's active case assignments and triggers auto-reallocation per slot.
- `POST /:id/reactivate` — OWNER + SUPER_ADMIN both inline (non-destructive).

**Audit events emitted (12 new eventTypes):** `STAFF_ASSIGNED_AUTO`, `STAFF_ASSIGNED_MANUAL`, `STAFF_REASSIGNED`, `OWNER_APPROVAL_REQUESTED`, `OWNER_APPROVAL_APPROVED`, `OWNER_APPROVAL_REJECTED`, `OWNER_APPROVAL_EXPIRED`, `OWNER_APPROVAL_EXECUTED`, `STAFF_USER_CREATED`, `STAFF_ROLE_CHANGED`, `STAFF_DEACTIVATED`, `STAFF_REACTIVATED`.

**Auto-allocation hook:** `DashboardService.getDashboard` calls `AssignmentsService.autoAllocate` once for each of the four slots when a `VisaCase` is freshly created in `ensureDashboardRows`. Each call is wrapped in try/catch — slots with no eligible staff stay unfilled until manual assignment.

**Student dashboard reflection:** the dashboard's `case` block now carries `assignedLia` and `assignedConsultant` (decrypted names), null when unfilled. SUPPORT and FINANCE assignees are intentionally not exposed to students.

## 6. How to test (manual)

1. **Migration applied:** `cd backend && npx prisma migrate status` — shows `20260520225802_pr_consult_1_staff_roles_and_allocation` applied.
2. **Backend builds:** `cd backend && npx tsc --noEmit` exits clean.
3. **Frontend builds:** `cd frontend && npx tsc --noEmit` exits clean.
4. **Promote an OWNER:** run the manual SQL snippet above on one User row.
5. **Create staff:** as the OWNER, `POST /api/staff/users` with `{ email, fullName, role: 'LIA' }` — receive `{ status: 'EXECUTED', tempPassword }`. The new user can log in with that temp password.
6. **Auto-allocate:** create a fresh STUDENT account → on first dashboard load the LIA slot picks the freshly-created LIA user. Inspect `visa_case_assignments` to confirm.
7. **Manual reassign:** as ADMIN, `POST /api/staff/assignments/manual-assign` with a new staff id → the prior assignment closes (sets `unassignedAt`), a new row opens, the student dashboard reflects the new LIA name on next load.
8. **Queue + approve:** as SUPER_ADMIN, `POST /api/staff/users/<id>/deactivate` → response `{ status: 'PENDING_OWNER_APPROVAL', requestId }`. As OWNER, `GET /api/staff/owner-approval/pending` → see the row. `POST /api/staff/owner-approval/<id>/approve` → returns `{ approval: { status: 'EXECUTED' } }` and the staff member's active flag is now false; their open assignments cascade-close and re-allocate to another staff of that role.
9. **Decline:** repeat 8 but `/reject` instead. Status becomes REJECTED; no execution.
10. **Expiry:** insert a row with `expiresAt` in the past, then call `GET /pending` — the row flips to EXPIRED and an audit row is written.
11. **ADMIN denied:** any of the destructive endpoints called as ADMIN → 403.

## 7. Known limitations

- **No consultant-side UI.** PR-CONSULT-2 builds the inbox, case-detail view, reassignment dialog, and the OWNER approval queue UI. Until then everything is API-only.
- **No staff-onboarding email.** Creating staff via OWNER returns the temp password in the response so it can be shared out-of-band; the OWNER (or an admin) emails it manually. A follow-up PR will wire `EmailModule.sendEmail` into `createStaffUserDirect`.
- **Stripe refunds are stubbed.** `ISSUE_REFUND` writes a `Refund` row with `status='PENDING_STRIPE_INTEGRATION'`. The actual Stripe call lands when payments are wired.
- **No global guard.** `StaffRolesGuard` is route-level (matching the existing `RolesGuard` pattern). Routes that don't carry a `@StaffRoles(...)` decorator pass through it — apply the decorator on every new staff route.
- **`assignedById` for auto-allocation on dashboard first-load is the student's own user id.** It's the only id available at that moment. The Wix lead-capture flow (later) will introduce a system service user; until then the audit log records the student as the actor for the initial auto-allocation.
- **Existing legacy `UserRole` values (`SALES`, `OPERATIONS`, `AGENT`) are not consumed by this PR.** They stay on rows that already have them, but the role matrix only references the seven canonical staff tiers. PR-CONSULT-2 (or a separate cleanup PR) decides whether to map them onto the new tiers.

## 8. How to extend

- **Add a new owner-only action type.** (1) Add the value to `OwnerApprovalActionType` enum + migration `ALTER TYPE`. (2) Add an executor branch in `OwnerApprovalService.executeApprovedAction`. (3) Route the relevant controller method through `requireOwnerOrEnqueue` (the `ownerOrEnqueue` helper on `StaffUsersService`). (4) Update the role-matrix table here.
- **Add a new case role slot.** (1) Add the value to `VisaCaseRoleSlot` enum + migration `ALTER TYPE`. (2) Add the eligible-user-role(s) to `ELIGIBLE_USER_ROLES` in `AssignmentsService`. (3) Add it to the slots array in `DashboardService.getDashboard` for first-load auto-allocation. (4) Decide whether to expose the new slot's assignee name on the student dashboard.
- **Replace the temp-password response with email.** Inject `EmailService` into `OwnerApprovalService`, send the temp password to the new user's email instead of returning it. Keep the response shape backward-compatible — return `{ ok: true, userId, email, role }` without `tempPassword`.
- **Replace the lazy expiry sweep with a cron job.** `OwnerApprovalService.sweepExpired` does on-read work today. Adding `@nestjs/schedule` + a once-an-hour `@Cron` decorator on a wrapper method is the smallest possible change.

## 9. Security layers applied

- **Layer 1 — auth:** every staff route is gated by `JwtAuthGuard + StaffRolesGuard`.
- **Layer 2 — role membership:** `@StaffRoles(...)` decorator + `STAFF_ROLES_KEY` metadata. ADMIN gets a hard 403 on the seven destructive routes; SUPER_ADMIN enqueues; OWNER executes inline.
- **Layer 3 — active-status check:** the new guard rejects any caller whose `StaffActiveStatus.isActive === false`. Missing row = treat as active so brand-new staff don't get locked out before any deactivation event.
- **Layer 4 — input validation:** class-validator DTOs on every body. Payload validation specifically for each owner-approval action type happens inside the corresponding executor (e.g. `execChangeStaffRole` rejects missing `userId` / `newRole`).
- **Layer 5 — encryption at rest:** AES-256-GCM via existing `CryptoService` on `OwnerApprovalRequest.payload`, `reason`, `decisionNote`, and `PlatformSetting.value`. Base64-encoded ciphertext in TEXT columns (same envelope as PR-DASH-3/4).
- **Layer 6 — rate limiting:** five DB-count guards — auto-allocate 30/h, manual-assign 60/h, owner-approval create 50/h, owner-approval approve/reject 100/h each.
- **Layer 7 — audit log:** 12 new structured `eventType` values written on every mutation. Includes the on-read EXPIRED sweep — those rows carry `userId=null` since the sweep is system-driven.
- **Layer 8 — ownership leak protection:** `StaffUsersService.detail` throws `ForbiddenException` for both "user does not exist" and "user is a STUDENT (not a staff row)" so the API doesn't reveal which student-ids exist.
- **Layer 9 — least-privilege execution:** even OWNER actions go through the same `executeApprovedAction` dispatch as queued ones — the OWNER doesn't get a back-door that bypasses audit logging.
- **Layer 10 — destructive-action separation of duties:** ADMIN cannot enqueue or execute owner-only actions. The role separation is enforced both at the controller (StaffRoles decorator) and at the service (`ownerOrEnqueue` throws 403 on anything below SUPER_ADMIN).

## 10. Rollback procedure

```bash
# 1. revert the feature commit
git revert afb00ea

# 2. drop tables + enums + revert enum values (run as the DB owner)
psql -d sorena_visa <<SQL
DROP TABLE IF EXISTS visa_case_assignments CASCADE;
DROP TABLE IF EXISTS owner_approval_requests CASCADE;
DROP TABLE IF EXISTS staff_active_status CASCADE;
DROP TABLE IF EXISTS refunds CASCADE;
DROP TABLE IF EXISTS platform_settings CASCADE;
DROP TYPE  IF EXISTS "VisaCaseRoleSlot";
DROP TYPE  IF EXISTS "OwnerApprovalStatus";
DROP TYPE  IF EXISTS "OwnerApprovalActionType";

-- Postgres can't drop a value from an enum cleanly. If you genuinely
-- need to remove OWNER / CONSULTANT / FINANCE from UserRole:
--   1. Rebuild the enum from scratch:
--      ALTER TYPE "UserRole" RENAME TO "UserRole_old";
--      CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SALES',
--        'OPERATIONS', 'LIA', 'SUPPORT', 'STUDENT', 'AGENT');
--      ALTER TABLE "users" ALTER COLUMN role TYPE "UserRole"
--        USING role::text::"UserRole";
--      DROP TYPE "UserRole_old";
--   2. Any User row with role IN ('OWNER','CONSULTANT','FINANCE')
--      must be re-roled first or that ALTER TABLE will fail.

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260520225802_pr_consult_1_staff_roles_and_allocation';
SQL

# 3. push the revert
git push origin main
```

The DB backup taken before the migration lives at `backend/backup_before_pr_consult_1.sql` (gitignored). Restore from it if anything goes sideways — the enum-value rollback above is the only fiddly bit, and restoring from the snapshot bypasses it entirely.
