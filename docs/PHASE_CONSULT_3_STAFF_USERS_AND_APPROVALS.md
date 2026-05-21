# PR-CONSULT-3 — Staff users UI + owner-approval queue UI

Handover for the first staff-CRUD and approval-queue UIs on top of PR-CONSULT-1's role + queue backend and PR-CONSULT-2's staff dashboard shell.

## 1. What this PR does

`/staff/users` and `/staff/approvals` are now real pages. OWNER can create, change-role, deactivate, and reactivate staff inline; SUPER_ADMIN can do the same but every destructive write is queued for OWNER approval and lands on the OWNER's Approvals page. ADMIN sees the staff list read-only — no action buttons.

The two-path execution UX (inline vs queued) is the central pattern:
- OWNER actions that return `{ status: 'EXECUTED', tempPassword? }` → success toast, or a one-time TempPasswordModal on CREATE_STAFF_USER so the OWNER can share the temp password out-of-band.
- SUPER_ADMIN actions that return `{ status: 'PENDING_OWNER_APPROVAL', requestId }` → "Sent for owner approval" toast with a deep-link to `/staff/approvals?tab=mine`.

The Approvals page has two tabs:
- **Pending** (OWNER only) — every PENDING `OwnerApprovalRequest`. Each row shows the requester, action type, payload preview (per-actionType renderer), reason, submitted/expires timestamps (turning red <24h), plus Approve / Reject buttons that open a shared decision overlay.
- **My Requests** (SUPER_ADMIN + OWNER) — the caller's own submissions with status pills (PENDING / APPROVED / REJECTED / EXPIRED / EXECUTED / EXECUTION_FAILED), decision time + note, and any execution error.

No backend endpoint changes — every route was already complete after PR-CONSULT-1.

## 2. Files changed

Backend (single trivial edit):
- `src/staff/me/staff-permissions.ts` — added a new `canViewApprovals` boolean to `StaffPermissions` (OWNER + SUPER_ADMIN). Used to gate the sidebar's "Approvals" item so SUPER_ADMIN can navigate to their Mine tab without typing the URL. `canApprove` remains OWNER-only and gates the Approve/Reject buttons.

Frontend (new under `src/`):
- `components/staff/users/` — `types.ts`, `useStaffUsersQuery.ts`, `StaffUsersPageHeader.tsx`, `StaffUsersTable.tsx`, `CreateStaffOverlay.tsx`, `TempPasswordModal.tsx`, `StaffDetailOverlay.tsx`, `ChangeRoleOverlay.tsx`, `DeactivateConfirmOverlay.tsx`, `ReactivateConfirmOverlay.tsx`, `StaffUsersPageClient.tsx`, `notify.tsx`.
- `components/staff/approvals/` — `types.ts`, `ApprovalStatusPill.tsx`, `ApprovalPayloadPreview.tsx`, `ApprovalDecisionOverlay.tsx`, `PendingApprovalsList.tsx`, `MyRequestsList.tsx`, `ApprovalsPageClient.tsx`.
- `components/staff/approvals/payload-renderers/` — one renderer per `OwnerApprovalActionType` value: `CreateStaffUserPayload`, `ChangeStaffRolePayload`, `DeactivateStaffPayload`, `DeleteCasePayload`, `DeleteStudentPayload`, `IssueRefundPayload`, `ChangePlatformSettingPayload`.

Frontend (existing):
- `contexts/StaffContext.tsx` — added `canViewApprovals` to the `StaffPermissions` shape + default values.
- `components/staff/shell/StaffSidebar.tsx` — Approvals nav item now gates on `canViewApprovals` rather than `canApprove`.
- `app/staff/users/page.tsx` — placeholder replaced with `StaffUsersPageClient`. Server-side role check still bounces non-admins to `/staff`.
- `app/staff/approvals/page.tsx` — placeholder replaced with `ApprovalsPageClient`. OWNER + SUPER_ADMIN only.
- `i18n/messages/en.json` + `fa.json` — ~60 new keys under `staff.users.*` and `staff.approvals.*`.

No schema changes. No new env vars. No new dependencies.

## 3. Backend endpoints (unchanged from PR-CONSULT-1)

All under `/api/staff/*`, gated by `JwtAuthGuard + StaffRolesGuard` and the appropriate `@StaffRoles(...)` decorator. The two-path return shape is the contract this PR is built around.

### Staff users

- `GET /api/staff/users` → `Array<{ id, email, name, role, createdAt, isActive }>` — ADMIN tier.
- `GET /api/staff/users/:id` → `{ id, email, name, role, createdAt, isActive }` — ADMIN tier; 403 (masked existence) when the row is a STUDENT or missing.
- `POST /api/staff/users` body `{ email, fullName, role, reason? }` — OWNER + SUPER_ADMIN.
  - OWNER  → `{ status: 'EXECUTED', userId, email, role, tempPassword }`
  - SUPER_ADMIN → `{ status: 'PENDING_OWNER_APPROVAL', requestId }`
- `PATCH /api/staff/users/:id/role` body `{ newRole, reason? }` — OWNER + SUPER_ADMIN.
  - OWNER  → `{ status: 'EXECUTED' }`
  - SUPER_ADMIN → `{ status: 'PENDING_OWNER_APPROVAL', requestId }`
- `POST /api/staff/users/:id/deactivate` body `{ reason? }` — OWNER + SUPER_ADMIN.
  - OWNER  → `{ status: 'EXECUTED' }`
  - SUPER_ADMIN → `{ status: 'PENDING_OWNER_APPROVAL', requestId }`
- `POST /api/staff/users/:id/reactivate` body `{}` — OWNER + SUPER_ADMIN inline (non-destructive); returns `{ ok: true }`.

### Owner approval queue

- `GET /api/staff/owner-approval/pending` — OWNER only. Returns every `PENDING` request, payload + reason decrypted. Runs an on-read expiry sweep.
- `GET /api/staff/owner-approval/mine` — SUPER_ADMIN + OWNER. Returns the caller's own 50 most recent requests, any status.
- `POST /api/staff/owner-approval/:id/approve` body `{ decisionNote? }` — OWNER only. Returns `{ approval: ApprovalRequest, executionResult: { ok, error? } }`. The executor runs synchronously inside the approve call.
- `POST /api/staff/owner-approval/:id/reject` body `{ decisionNote? }` — OWNER only.

### Workload (used by StaffDetailOverlay)

- `GET /api/staff/assignments/workload?staffId=:id` — admin tier can pass `?staffId=`. Returns `{ activeCount, byRoleSlot: { LIA, CONSULTANT, SUPPORT, FINANCE } }`.

## 4. Frontend architecture

### Two-path response handling

Every write that goes through `ownerOrEnqueue` returns one of two shapes. The shared helper file `components/staff/users/types.ts` exposes:

```ts
type ActionResult =
  | { status: 'EXECUTED'; userId?: string; email?: string; role?: string; tempPassword?: string }
  | { status: 'PENDING_OWNER_APPROVAL'; requestId: string };

isPendingApproval(result)        // narrows to the queued case
isExecutedWithPassword(result)   // narrows to the OWNER-create case carrying tempPassword
```

The flow in every action overlay:

```ts
const result = await api.post('/api/staff/users', body);
if (isPendingApproval(result)) {
  notifySentForApproval(...);       // toast → /staff/approvals?tab=mine
  onDone(); onClose();
  return;
}
if (isExecutedWithPassword(result)) {
  setTempPassword(result.tempPassword); // open one-time TempPasswordModal
  return;
}
toast.success(...);                  // regular inline execution
```

### TempPasswordModal

OWNER's CREATE_STAFF_USER returns the raw `tempPassword` in the response (PR-CONSULT-1 stores it bcrypted; the response is the only place it ever exists in plaintext). The modal:
- Renders it inside a read-only textarea (select-all on focus).
- Manual close only — no auto-dismiss, no close-on-overlay-click.
- Copy-to-clipboard button with a 2s "Copied" state. Falls back gracefully when `navigator.clipboard.writeText` is blocked.
- Closes via the "Done" button, which triggers the list refresh.

### Self-lockout guard

`StaffDetailOverlay` hides Change-role / Deactivate / Reactivate when:
- The detail target is the signed-in user themselves (`me.id === user.id`).
- The detail target has role `OWNER` (can't change role / deactivate via UI — handover doc covers DB-direct OWNER promotion / demotion).

This is enforced as a hide-not-disable so there's no confusing "why can't I click this" moment. The backend will still 400 if a request slips through.

### Approvals decision overlay

`ApprovalDecisionOverlay` is shared between Approve and Reject — same component, mode prop branches title, button colour, and endpoint. The optional `decisionNote` is sent to either endpoint. On Approve we read `executionResult.ok`:

- `ok: true`  → `toast.success(t('staff.approvals.executed'))` ("Approved and executed.").
- `ok: false` → `toast.error(t('staff.approvals.executionFailed', { error }))` with 10s duration so the OWNER can read the failure reason.

The page list refreshes after either decision.

### Payload renderers

Each `OwnerApprovalActionType` gets a dedicated component under `payload-renderers/`. The `ApprovalPayloadPreview` dispatcher picks one based on `actionType`. Unknown action types fall back to a JSON dump — better than blank when a future PR adds a new type before the renderer ships.

`CHANGE_STAFF_ROLE` and `DEACTIVATE_STAFF` payloads carry only the target user's ID. We deliberately don't fetch the target user's name in the renderer (would fire one extra GET per row); the OWNER can open `/staff/users` in another tab if they need the context.

### Sidebar gate change

The Approvals nav item now uses `canViewApprovals` (OWNER + SUPER_ADMIN) instead of `canApprove` (OWNER only). Without that change, SUPER_ADMIN had no way to reach `/staff/approvals` from the sidebar — they had to follow the deep-link in the toast. The OWNER-specific Approve/Reject buttons still gate on `canApprove`; the page renders the right tab set based on role inside `ApprovalsPageClient`.

## 5. UI rules applied

- Navy `#1e3a5f` primary, gold `#c9a961` accent, off-white `#faf8f3` background.
- All buttons ≥48px (`min-h-[48px]`); 12px (`rounded-xl`) for buttons and inputs; 16px (`rounded-2xl`) for cards / overlays.
- Inline overlay modals only — every overlay in this PR is a hand-rolled fixed-position element.
- RTL handled by the existing `LocaleProvider` flipping `<html dir="rtl">` when fa is active.
- Role badges via the existing `StaffRoleBadge`. Status pills hand-rolled in `ApprovalStatusPill` (six values, all colour-coded by tier — pending/amber, approved/emerald, rejected/rose, executed/emerald-darker, expired/gray, execution_failed/rose-darker).
- Approve button uses gold bg per "primary action" rule. Reject is a secondary outlined button.

## 6. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **OWNER signed in:**
   - Open `/staff/users`. List shows existing staff (just OWNER initially).
   - Click "Create staff" → overlay. Fill in first name, last name, email, role → submit.
   - TempPasswordModal opens. Copy works. Click "Done" → modal closes, list refreshes with new user.
   - Click the new user's row → detail overlay. Workload panel renders `0 active assignments` + 4 per-slot tiles.
   - Click "Change role" → role select → submit. Toast "Role updated". Detail overlay refreshes.
   - Click "Deactivate" → confirm → toast "Staff deactivated". User's Active column flips. Open detail again — "Deactivate" replaced by "Reactivate".
   - Click "Reactivate" → instant success toast.
   - Open the OWNER's own row → no destructive buttons visible. (self-lockout guard.)
3. **SUPER_ADMIN signed in** (after the OWNER promotes one):
   - `/staff/users` still works. Create / change-role / deactivate now produce the "Sent for owner approval" toast with a "View status" link.
   - Click the link → `/staff/approvals?tab=mine` → My Requests tab open with the PENDING row visible.
4. **OWNER returns:**
   - `/staff/approvals` defaults to the Pending tab. Sees the SUPER_ADMIN's request with action type label, payload renderer, requester name + email + role badge, submitted relative time, expires (red if <24h).
   - Click Approve → decision overlay → optional note → Confirm. Toast "Approved and executed." Row disappears (status flipped EXECUTED). The underlying action took effect (verify via `/staff/users` list).
   - Click Reject on another row → toast "Rejected".
5. **ADMIN signed in:**
   - `/staff/users` renders the table. No "Create staff" button. Clicking a row opens the detail overlay; no action buttons inside (PermissionGate hides them).
   - `/staff/approvals` → server-side redirect to `/staff`.
6. **LIA / CONSULTANT / SUPPORT / FINANCE signed in:**
   - Sidebar shows no Staff or Approvals items.
   - Direct URL to `/staff/users` or `/staff/approvals` → server-side redirect to `/staff`.
7. **i18n:** toggle to fa via the locale button. All staff.users.* and staff.approvals.* strings render in Persian; layout flips to RTL.
8. **Edge cases worth checking once:**
   - SUPER_ADMIN submits a deactivate for themselves → backend will let them enqueue, OWNER will see the request and can approve or reject.
   - Two SUPER_ADMINs each request CHANGE_STAFF_ROLE on the same user → OWNER sees both; approving the first executes; approving the second still works (re-applies the role change).

## 7. Known limitations

- **Email isn't wired.** Creating a staff user returns the temp password in the OWNER's response, displayed in `TempPasswordModal`. The OWNER must share it out-of-band (signal, in-person, etc.) until a future PR pipes it through `EmailModule.sendEmail`. The backend bcrypts immediately, so there's no second chance to read it.
- **`locale` field is captured but not persisted.** The Create overlay has an `Preferred language` dropdown (en | fa), but `CreateStaffUserDto` on the backend doesn't carry a locale column on `User`. The dropdown is intentional UX (signals what we'll wire up when the column lands) and the field is silently dropped before POST. The handover note for whoever wires email also adds the column.
- **Workload endpoint may 403 for non-admin staff inspecting other users.** Today `/api/staff/assignments/workload?staffId=` requires the caller be admin tier. ADMIN viewing a staff detail will see the workload panel; SUPER_ADMIN + OWNER too. Lower roles never reach the page so this never bites.
- **`CHANGE_STAFF_ROLE` payload preview shows the target user's ID, not their name.** Adding the name needs either (a) the backend embedding the resolved User snapshot when it encrypts the payload, or (b) the frontend firing one extra GET /staff/users/:id per row. Neither is in scope for this PR. The audit log keeps the full context.
- **OWNER promotion / demotion is intentionally not in the UI.** The Create role dropdown excludes `OWNER`; the Change-role dropdown also excludes it. Promoting / demoting OWNER must happen via direct DB write (the manual SQL snippet documented in PR-CONSULT-1's handover). This is a guardrail against accidental founder lockout.
- **No bulk actions.** Deactivating five staff at once means five overlay submits. Bulk is out of scope until there's a real need.
- **`canApprove` deliberately stays OWNER-only.** SUPER_ADMIN can view the Approvals page (Mine tab) but never sees the Approve/Reject buttons on Pending. We add `canViewApprovals` as a sidebar-visibility helper; `canApprove` continues to gate the actual decision buttons.
- **Decision-overlay toast for a successful Reject reads "Rejected" via the status-pill i18n key.** A future polish PR could add a dedicated `staff.approvals.rejected` line for the toast; today we reuse the pill text.

## 8. How to extend

- **Add a new OwnerApprovalActionType.** (1) Extend the enum in `prisma/schema.prisma` + an `ALTER TYPE` migration. (2) Add an executor branch in `OwnerApprovalService.executeApprovedAction`. (3) Add a new payload renderer under `frontend/src/components/staff/approvals/payload-renderers/` and a new switch case in `ApprovalPayloadPreview`. (4) Add a new key under `staff.approvals.actionType.*` in en + fa.
- **Wire staff-creation email.** Inject `EmailService` into `OwnerApprovalService.createStaffUserDirect`, push the tempPassword over email, drop `tempPassword` from the response shape. Frontend keeps working — `isExecutedWithPassword` returns false, falls through to the generic success toast. The `TempPasswordModal` import can stay (no-op when password is absent) or be removed.
- **Add a new permission.** Extend `StaffPermissions` in `backend/src/staff/me/staff-permissions.ts` AND the matching interface in `frontend/src/contexts/StaffContext.tsx` (plus the default-permissions block). Then use it via `<PermissionGate require="newKey">` or the sidebar's `gate` field.
- **Add a Reject-with-required-note rule.** Wrap the `submitButton` in `ApprovalDecisionOverlay` with `disabled={mode === 'reject' && decisionNote.trim() === ''}`. Backend already accepts an optional note.
- **Wire the audit feed into the Approvals page.** A small expansion: add a third tab "All" (OWNER only) that calls a new endpoint listing every approval row in any state — useful for a compliance trail.

## 9. Security layers applied

- **Layer 1 — auth:** every route under `/api/staff/*` is gated by `JwtAuthGuard`. Pages double-check the session server-side before rendering.
- **Layer 2 — role membership:** `@StaffRoles(...)` decorators on every backend route. ADMIN gets a hard 403 on destructive routes; SUPER_ADMIN enqueues; OWNER executes inline. Page-level `redirect('/staff')` for non-admin direct URL access.
- **Layer 3 — active-status check:** inherited from PR-CONSULT-1's `StaffRolesGuard` — deactivated staff get rejected before the controller runs.
- **Layer 4 — frontend permission gates mirror backend checks.** Every UI affordance gated by `<PermissionGate require="...">` corresponds to a backend route that enforces the same role check at the API layer. UI-side gating is for ergonomics, not security.
- **Layer 5 — input validation:** `react-hook-form + zod` schemas on every form. Backend `class-validator` DTOs enforce the same constraints. Email is lowercased + trimmed before POST.
- **Layer 6 — two-path execution.** Destructive actions for SUPER_ADMIN go through encrypted, expiry-bounded approval requests. The OWNER explicitly approves before the action executes. Audit log captures both transitions.
- **Layer 7 — temp-password is shown exactly once.** The TempPasswordModal manual-close gate prevents accidental dismiss; the backend bcrypts on creation so no second-chance read is possible.
- **Layer 8 — self-lockout guard.** UI hides destructive actions on the signed-in user's own row + on any OWNER row. Backend still enforces the role rules independently.
- **Layer 9 — payload preview decrypts only at read time.** OwnerApprovalRequest.payload is AES-256-GCM at rest; the API decrypts inside `shapeForApi` only for callers who passed the `@OwnerOnly()` / `@StaffRoles(...)` guard.
- **Layer 10 — no secret leakage in error messages.** Backend exception filter surfaces "A user with that email already exists" but never echoes the existing user's id or name back to the SUPER_ADMIN. Failed approvals show their backend error message via `executionError`, which is operator-facing and only visible to OWNER + the original requester.

## 10. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git revert HEAD~1..HEAD

# 2. push the revert
git push origin main
```

No DB migration, no env vars, no third-party state — the rollback is purely a code revert. The placeholder pages from PR-CONSULT-2 come back, and the backend endpoints are still there (they were already complete after PR-CONSULT-1). Anyone signed in stays signed in; the only visible change is the page bodies revert to "Coming soon".

The single backend edit (`canViewApprovals` permission) is additive and harmless if reverted alongside the frontend — the frontend would see `undefined` for it and the sidebar would simply not render the Approvals item to anyone (the deep-link still works for OWNER via `canApprove`-derived state).

## Day 1 actions — onboarding the first staff cohort

Once this PR is deployed and you're signed in as OWNER at `/staff/users`, create the following accounts via the Create overlay. Use any plausible email if the placeholder doesn't match the final domain (you can `PATCH /api/staff/users/:id/role` to change role later; you can't change email through the UI today).

| Name | Role | Email (placeholder) |
|---|---|---|
| Sheila Rose | `LIA` | `sheila@sorenavisa.com` |
| Iydin Tashvighi | `ADMIN` | `iydin@sorenavisa.com` |
| Elisa | `SUPPORT` | `elisa@sorenavisa.com` |
| Arjmand (Finance) | `FINANCE` | `finance@sorenavisa.com` |

For each user:
1. Open Create overlay → fill first name + last name + email + role → submit.
2. Copy the temp password from `TempPasswordModal` immediately and store it where the staff member can reach it (Signal, in-person, whatever your team uses).
3. Share the password with the staff member alongside the login URL.
4. They sign in, the existing student-side password-reset flow lets them rotate to their own password.

After these four exist, the auto-allocation pipeline (PR-CONSULT-1) will start populating the LIA / CONSULTANT / SUPPORT / FINANCE slots on every fresh `VisaCase`. The OWNER stays the FINANCE-second-account as well, separate audit trail, which lets the OWNER and `Arjmand (Finance)` row appear in distinct audit log lines.

**Note on the Finance second-account.** The OWNER has a personal account. The `Arjmand (Finance)` row is a separate User with role FINANCE so refund / settings audit rows carry that audit-distinct identity. Sign in as that second user when performing finance actions — do not perform them from the OWNER account.

**OWNER promotion (still manual SQL).** If you ever need a second OWNER, run:

```sql
UPDATE "users" SET role = 'OWNER' WHERE email = '<email>';
```

The UI deliberately doesn't expose OWNER in any role dropdown. The backend `executeApprovedAction` will execute a CHANGE_STAFF_ROLE to OWNER if you bypass the UI dropdown (e.g. via curl), but the standard flow stays SQL-only.
