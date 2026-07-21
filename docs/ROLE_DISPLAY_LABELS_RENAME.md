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
