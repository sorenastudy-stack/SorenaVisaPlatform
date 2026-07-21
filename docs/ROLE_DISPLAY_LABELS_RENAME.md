# Role display-label rename — "Admission Officer" / "Client Officer"

**Date:** 2026-07-21

## What changed

Two role **display labels** were renamed everywhere they are shown to a user.
This is **presentation only** — enum values, DB columns, API contract, and JWT
role strings are unchanged.

| Enum value (unchanged) | Old label(s) shown | New label |
|------------------------|--------------------|-----------|
| `CONSULTANT`           | "Consultant" (badges/dropdowns), "Admission Specialist" (case slot) | **Admission Officer** |
| `CLIENT_CONSULTANT`    | "Client Consultant" | **Client Officer** |

Portal branding: `CONSULTANT` → **"Admission Officer Portal"**,
`CLIENT_CONSULTANT` → **"Client Officer Portal"**.

## Where the labels come from

The staff role badge and the secondary-roles dialog both resolve their text
through the central i18n map `staff.roles.*` in
[frontend/src/i18n/messages/en.json](../frontend/src/i18n/messages/en.json)
(`t('staff.roles.${role}')`). Updating that map fixes both at once. The
remaining edits are hard-coded slot/branding literals that don't go through the
map.

## Files changed

1. **`frontend/src/i18n/messages/en.json`** — the central map:
   `staff.roles.CONSULTANT` → "Admission Officer",
   `staff.roles.CLIENT_CONSULTANT` → "Client Officer". Fixes the staff role
   badge (`StaffRoleBadge`) and the `/staff/users` secondary-roles dialog
   (`SecondaryRolesSection`) automatically. Also two client-facing keys that
   labelled the same CONSULTANT role: `staff.cases.columns.consultant`
   ("Consultant" → "Admission Officer", the cases-list column header) and
   `portal.case.team.consultant` ("Admission Specialist" → "Admission Officer",
   the client "Your team" panel).
2. **`frontend/src/lib/portal-branding.tsx`** — split the shared case so
   `CONSULTANT` → "Admission Officer Portal" and `CLIENT_CONSULTANT` →
   "Client Officer Portal".
3. **`frontend/src/components/staff/cases/detail/CaseAssignmentsPanel.tsx`** —
   slot labels ("Admission Officer" / "Client Officer").
4. **`frontend/src/components/staff/cases/detail/ReassignOverlay.tsx`** —
   reassign picker `SLOT_CONFIG` labels.
5. **`frontend/src/components/staff/users/StaffDetailOverlay.tsx`** — workload
   grid slot captions.
6. **`frontend/src/app/ops/handoffs/page.tsx`** — `SLOT_LABEL` (`CONSULTANT`
   handoff slot = the Client Officer pool) + the empty-pool banner copy.
7. **`frontend/src/app/portal/booking/page.tsx`** — gap-closing plan blurb.

## What was deliberately NOT changed

- **Enum / DB / API / JWT values** — `CONSULTANT`, `CLIENT_CONSULTANT` remain
  the wire values everywhere.
- **Code comments** — several `//` comments still reference "Admission
  Specialist" / "Client Consultant" as the historical external names to
  document the enum→label mapping. Not user-facing; left as-is.
- **Raw `a.role` enum-string displays** in the `/staff/tickets` and
  `/staff/leads` eligible-staff pickers — these render the bare enum
  (`CLIENT_CONSULTANT`), not the "Client Consultant" label, so they don't
  violate the rename.

## Verification

- `grep` — no user-facing "Client Consultant" / "Admission Specialist" /
  "Consultant Portal" rendered text remains (only `//` comments).
- Enum values confirmed untouched.
- `npx tsc --noEmit` → 0 errors.

---

# Follow-up (2026-07-21) — single central role resolver + missing labels

## The bug

The staff-list ROLE column (and other surfaces) rendered broken text:
`STAFF.ROLES.LEAD`, plus raw enum strings elsewhere. Root cause: `User.role`
uses the Prisma **`UserRole`** enum (13 values), but the `staff.roles.*` i18n
map only had 8 keys. `StaffRoleBadge` rendered `t('staff.roles.${role}')`
directly; for a value with no key (LEAD/STUDENT/SALES/OPERATIONS/AGENT),
next-intl returns the key path `staff.roles.LEAD`, which the badge's
`uppercase` CSS shows as `STAFF.ROLES.LEAD`. (The "IMMIGRATION ADVISER" /
"FINANCE" / "OWNER" rows were actually resolving correctly — just uppercased by
the badge's pill styling.)

Separately, several surfaces rendered `{x.role}` **raw** (no map at all):
lead/ticket assignee dropdowns, team chips, the hard-delete approval payload,
and the workload-grid `: slot` fallback.

## The fix — one resolver, one map

New hook **[`frontend/src/lib/role-label.ts`](../frontend/src/lib/role-label.ts)**
`useRoleLabel()` is now the **single entry point** for role → label. It reads
the `staff.roles.*` map and, for any value without a key, falls back to a
title-cased form of the enum (`SUPER_ADMIN` → "Super Admin") so a raw enum or
unresolved key can never reach a user again.

The `staff.roles` map (en) was completed with the 5 missing `UserRole` values:

| Enum | Label |
|------|-------|
| `SALES` | Sales |
| `OPERATIONS` | Operations |
| `LEAD` | Lead |
| `STUDENT` | **Client** |
| `AGENT` | Agent |

(`STUDENT` → "Client" because in this platform a paid student *is* the client.)

## Every surface now routed through `useRoleLabel()`

- `components/staff/shell/StaffRoleBadge.tsx` — the pill used by the staff-list
  ROLE column, the top bar, and the detail overlay header.
- `components/staff/users/StaffDetailOverlay.tsx` — workload-grid slot captions.
- `components/staff/users/{CreateStaffOverlay,ChangeRoleOverlay,SecondaryRolesSection,StaffUsersPageHeader}.tsx`
  — role dropdowns / checkboxes / filter (previously `t('staff.roles.${r}')`
  direct; now the hook, so there is exactly one map consumer).
- `components/staff/cases/detail/CaseAssignmentsPanel.tsx` — case Assignments
  slot labels (dropped the split hardcoded/`SLOT_I18N_KEYS` logic).
- `components/staff/cases/detail/ReassignOverlay.tsx` — reassign picker label
  (dropped the hardcoded `label` field from `SLOT_CONFIG`).
- `components/staff/team/{StaffListClient,StaffEditClient}.tsx` — team list /
  edit role chips.
- `components/staff/approvals/payload-renderers/HardDeleteStaffPayload.tsx` —
  approval payload role row.
- `app/staff/leads/page.tsx`, `app/staff/leads/[id]/page.tsx`,
  `app/staff/tickets/[id]/page.tsx` — assignee dropdowns + current-assignee
  labels (previously raw `({a.role})` → e.g. "(CLIENT_CONSULTANT)").

## Deliberately NOT routed through the role map

- `app/ops/handoffs/page.tsx` `SLOT_LABEL` — a **different taxonomy**: the
  `CONSULTANT` handoff slot maps to the *Client Officer* pool, and `ADMISSION`
  / `PASTORAL` aren't `UserRole` values at all. Already clean labels; using the
  role map here would be semantically wrong.
- `lib/portal-branding.tsx` — portal *names* ("Legal Portal"), not role labels.
- `app/lia/cases/[id]/inz-data/page.tsx` "Role" field — an employment job
  title (free text), not a platform role.

## Note on Persian (`fa.json`)

Per the "English only, no Persian" constraint, the 5 new keys were added to
`en.json` only. Under the `fa` locale those values fall back (via the hook) to
the English title-cased form rather than a fabricated Persian translation. The
staff portal labels are English throughout, so no raw key or enum leaks in
either locale.

## Verification

- `grep` — zero direct `t('staff.roles.*')` renders remain; the hook is the
  only map consumer. No raw `{x.role}` role render remains (the one hit is the
  INZ employment job title).
- `npx tsc --noEmit` → 0 errors. `npm run build` → success.
- Enum / DB / API / JWT values unchanged.
