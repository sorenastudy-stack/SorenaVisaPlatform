# PHASE-Q — Client Consultant assignment slot (UI)

The `consultantId` slot (the `CLIENT_CONSULTANT` "real client Consultant") had a
complete backend — column, relation, auto-assign, an audited `PATCH
/cases/:id/consultant` endpoint, and an OPS handoffs dashboard that assumes it —
but **no manual-assignment UI**. The case-detail Assignments panel rendered only
4 slots and never wrote `consultantId`, so it was `null` on every case and every
`CLIENT_CONSULTANT` saw no cases. This PR adds the missing **5th slot** to the
panel, wired to the existing endpoint. No new endpoint, no schema change.

## 1. What this PR does

- Adds a **"Client Consultant"** row to `CaseAssignmentsPanel` (slot
  `CLIENT_CONSULTANT` → `Case.consultantId`), with the same Reassign UX, reason
  field, `StaffAvatar`, and unassigned state as the other 4 slots.
- The reassign picker lists **only eligible `CLIENT_CONSULTANT` staff** (new
  `eligible-staff?slot=CLIENT_CONSULTANT` branch), and Confirm writes through the
  **existing** guarded, audited `PATCH /cases/:id/consultant`.
- Surfaces the slot in the case-detail response so it shows the current assignee
  or an "unassigned" state (the whole point: admins must see + fill the gap on
  existing cases).

## 2. Why (the gap this closes)

`consultantId` is the designated home of the `CLIENT_CONSULTANT` role and the
column its `/staff/cases` visibility filter reads
(`{ consultantId: caller.userId }`). But the only writers were auto-assignment
(fires once at case creation, silently leaves `null` when no consultant is
active) and a backend endpoint **no UI called**. Net result in prod:
`consultantId` populated on **0** cases → the role's list was permanently empty.
This adds the manual control the OPS handoffs dashboard already tells admins to
use ("staff it via the existing reassign endpoints").

## 3. Slot model (unchanged, now fully surfaced)

| Panel label | Column | Auth role | Endpoint |
|---|---|---|---|
| Immigration Adviser | `liaId` | `LIA` | `PATCH /cases/:id/lia` |
| Admission Specialist | `ownerId` | `CONSULTANT` | `PATCH /cases/:id/owner` |
| **Client Consultant (new)** | **`consultantId`** | **`CLIENT_CONSULTANT`** | **`PATCH /cases/:id/consultant`** |
| Support | `supportId` | `SUPPORT` | `PATCH /cases/:id/support` |
| Finance | `financeId` | `FINANCE` | `PATCH /cases/:id/finance` |

`CLIENT_CONSULTANT` is placed next to `CONSULTANT` so the two consultant-type
roles are adjacent. All slots share one overlay (`ReassignOverlay`), driven by
`SLOT_CONFIG`.

## 4. Files changed

- **Backend:**
  - `staff/cases/staff-cases.service.ts` — `getCaseDetail` now `include`s
    `consultant`, presigns its photo, and emits `assignments.CLIENT_CONSULTANT`;
    `listEligibleStaff` gains a `CLIENT_CONSULTANT` branch (role
    `CLIENT_CONSULTANT`, open-case count via the `consultantCases` relation).
  - `staff/cases/staff-cases.controller.ts` — `eligible-staff` accepts
    `slot=CLIENT_CONSULTANT`.
- **Frontend:**
  - `components/staff/cases/detail/types.ts` — `RoleSlot` adds `CLIENT_CONSULTANT`.
  - `components/staff/cases/detail/CaseAssignmentsPanel.tsx` — 5th slot in `SLOTS`,
    "Client Consultant" label.
  - `components/staff/cases/detail/ReassignOverlay.tsx` — `SLOT_CONFIG` entry
    (`/cases/:id/consultant`, body key `consultantId`).
- **Test (gitignored):** `backend/scripts/test-client-consultant-slot.ts`.
- **No** `prisma/schema.prisma` or migration change.

## 5. Configuration

None. No env, schema, migration, or new endpoint. Reuses the existing
`PATCH /cases/:id/consultant` (`@Roles('OWNER','ADMIN','SUPER_ADMIN')`). Frontend
and backend deploy independently.

## 6. How to test

`backend/scripts/test-client-consultant-slot.ts` — **16/16 PASS** (run from
`backend/`: `npx ts-node scripts/test-client-consultant-slot.ts`):

- **Picker:** `slot=CLIENT_CONSULTANT` lists CLIENT_CONSULTANT users (with
  `activeCaseCount`), excludes the CONSULTANT; `slot=CONSULTANT` unchanged.
- **Detail:** exposes `assignments.CLIENT_CONSULTANT` (null → unassigned state);
  the other 4 slots still present.
- **Assign:** writes `Case.consultantId`, logs `CONSULTANT_MANUAL_REASSIGNED`,
  leaves `ownerId` untouched; detail then shows the assignee.
- **Visibility:** the assigned `CLIENT_CONSULTANT` now sees the case at
  `/staff/cases`; a *different* `CLIENT_CONSULTANT` does not.
- **Security:** assigning a `CONSULTANT` or `OWNER` to the slot → `BadRequest`
  (endpoint guard `target.role !== 'CLIENT_CONSULTANT'`); the valid assignment is
  not overwritten. In the UI this can't even be selected (picker lists only
  CLIENT_CONSULTANTs); if it ever occurs, the overlay surfaces the 400 via
  `toast.error(err.message)`.

`nest build` clean; frontend `tsc --noEmit` clean (0 errors). (Local dev DB was
missing the `users.photoKey` column from earlier `db push` drift — added locally
to run the test; unrelated to this change and already present in prod.)

## 7. Known limitations / deliberate exclusions

- **No "unassign / clear" control** — matching the other 4 slots exactly. The
  `ReassignOverlay` requires selecting a candidate; none of the slots expose a
  null-clear today. The backend accepts `consultantId: null`, so a cross-slot
  "Unassign" affordance is a clean future addition for all five at once.
- **English-only label** — "Client Consultant" is an English literal (Persian is
  frozen); no `fa`/`en` dictionary key was added, matching how "Admission
  Specialist" is handled.
- **Auto-assign backfill unchanged** — auto-assignment still only fires at case
  creation. Existing cases with `consultantId: null` are now fixable by an admin
  through this new control (which is exactly what it's for).

## 8. How to extend

- **Add a clear/unassign affordance:** add an "Unassign" option to
  `ReassignOverlay` that submits `{ [bodyKey]: null, reason }` — it works for all
  five slots since every endpoint already accepts `null`.
- **Another slot:** add the column + `@relation` back-ref, a `listEligibleStaff`
  branch, an `assignments.<KEY>` emit, the `RoleSlot` union, `SLOTS`, and a
  `SLOT_CONFIG` entry. This PR is the reference diff.

## 9. Security

- **No new endpoint / no widened access.** Reuses `PATCH /cases/:id/consultant`,
  still `@Roles('OWNER','ADMIN','SUPER_ADMIN')` behind `RolesGuard`, still audited.
- **Role integrity enforced server-side:** the endpoint rejects any target whose
  role isn't `CLIENT_CONSULTANT` (plus active/archived checks) — proven by test.
  The UI additionally only offers `CLIENT_CONSULTANT` candidates, so the wrong
  role can't be selected; the server guard is the real boundary.
- **No client-trusted role or identity** — the actor comes from the JWT
  (`req.user`); the picker candidate list is admin-gated (`@AdminTier`).

## 10. Rollback procedure

- **Code-only, no data/schema.** Revert the commit — the panel returns to 4
  slots and the detail response stops emitting `CLIENT_CONSULTANT`. Any
  `consultantId` values already written by the new control remain valid (the
  visibility filter and OPS handoffs still read them); nothing is orphaned.
- Frontend and backend roll back independently; no migration to reverse.
