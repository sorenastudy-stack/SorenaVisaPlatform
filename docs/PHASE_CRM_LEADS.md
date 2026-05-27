# PR-CRM-LEADS — Unified /staff/leads list + essentials detail

## 1. Purpose

Build a unified staff-side view of every lead across every source
(Scorecard, Wix lead-capture, manual, WhatsApp, etc.) with strong
filtering, status changes, and reassignment. The detail page focuses
on essentials and links out to deeper views (full scorecard, Wix
payment detail) for drill-down.

Single commit covering backend (service + controller + audit
helpers) and frontend (list page, detail page, chip components,
sidebar entry, i18n).

## 2. Exploration findings

Reported in-line before writing code:

| What                                       | Status                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `Lead` model                               | Already rich — `contactId`, `ownerId`, `leadStatus`, `sourceChannel` (free text), `scoreBand`, `readinessScore`, `trackingLinkId`, `attributedAgentId`, relations to Contact, ScorecardSubmission, WixPayment[], Case[], LeadStatusHistory. |
| `LeadStatus` enum                          | 11 values — **no literal `CONVERTED`**. `CLOSED_WON` is used as the conversion equivalent (LEAD_CONVERTED audit event fires alongside LEAD_STATUS_CHANGED when target=CLOSED_WON). |
| `LeadSource` enum                          | Does not exist. Source is a free-text `sourceChannel` column — values like `SCORECARD`, `WIX_LEAD_CAPTURE`, `MANUAL`. Treated as a string filter. |
| `LeadNote` model                           | Does not exist. The note endpoint was skipped per spec. |
| Existing backend                           | `/leads` controller (no role gate on list) — left **untouched**. New `/staff/leads/*` routes added alongside in the same module. |
| Existing frontend                          | `/sales/leads/*` exists with list + detail + override panel + status timeline + the `LeadWixPayments` component from PR-SCORECARD-4. `/staff/leads/` did not exist. |

## 3. Routing decision

- **Canonical**: `/staff/leads` (new). This is the sidebar nav target.
- **Legacy preserved**: `/sales/leads/*` still works untouched; it
  remains the entry point for the override panel + AI summary + full
  status-transition history.
- The new detail page links to `/sales/leads/:id` as "Open in legacy
  sales view" so users can still reach the advanced controls without
  us porting them in this PR.
- The `LeadWixPayments` component is re-imported from
  `app/sales/leads/[id]/LeadWixPayments.tsx` — no duplication.

## 4. Backend

### New files

- `backend/src/leads/staff-leads.service.ts` — `list / detail /
  updateStatus / assign / listAssignees`. Audit rows written for
  every mutation + on detail view.
- `backend/src/leads/staff-leads.controller.ts` — `/staff/leads/*`
  endpoints with role gates per the matrix in §5.

### Modified files

- `backend/src/leads/leads.module.ts` — register the new
  controller + service alongside the legacy ones.
- `backend/src/common/audit/audit.helper.ts` — added human-readable
  summaries for `LEAD_VIEWED_BY_STAFF`, `LEAD_STATUS_CHANGED`,
  `LEAD_ASSIGNED`, `LEAD_CONVERTED`.

### Routes

| Method | Path                            | Roles                                          |
| ------ | ------------------------------- | ---------------------------------------------- |
| GET    | `/staff/leads`                  | OWNER, SUPER_ADMIN, ADMIN, CONSULTANT, FINANCE |
| GET    | `/staff/leads/assignees`        | same                                           |
| GET    | `/staff/leads/:id`              | same                                           |
| PATCH  | `/staff/leads/:id/status`       | OWNER, SUPER_ADMIN, ADMIN, CONSULTANT          |
| PATCH  | `/staff/leads/:id/assign`       | OWNER, SUPER_ADMIN, ADMIN                      |

Filters on the list endpoint: `source`, `status`, `assignedToId`
(or `unassigned` sentinel), `search` (name/email/phone), `dateFrom`,
`dateTo`, `band` (or `NONE` sentinel), `limit` (≤100, default 25),
`offset`, `sortBy` (createdAt|name|status|band), `sortOrder`
(asc|desc, default desc).

### Audit events

- `LEAD_VIEWED_BY_STAFF` — best-effort write inside `detail()`,
  failure does not block the page.
- `LEAD_STATUS_CHANGED` — `oldValue.status` + `newValue.status,note`.
- `LEAD_ASSIGNED` — `oldValue.assignedToId` + `newValue.assignedToId`
  (either nullable).
- `LEAD_CONVERTED` — fires only when target status is `CLOSED_WON`
  and the previous status wasn't already `CLOSED_WON`. Spec asked
  for "CONVERTED" but the existing enum has no such value; we map
  conversion → CLOSED_WON.

## 5. Permissions matrix

| Action            | OWNER | SUPER_ADMIN | ADMIN | CONSULTANT | FINANCE | LIA | SUPPORT |
| ----------------- | :---: | :---------: | :---: | :--------: | :-----: | :-: | :-----: |
| View list         |   ✅  |     ✅      |  ✅   |     ✅     |   ✅    | ❌  |   ❌    |
| View detail       |   ✅  |     ✅      |  ✅   |     ✅     |   ✅    | ❌  |   ❌    |
| Change status     |   ✅  |     ✅      |  ✅   |     ✅     |   ❌    | ❌  |   ❌    |
| Reassign          |   ✅  |     ✅      |  ✅   |     ❌     |   ❌    | ❌  |   ❌    |

Enforced at the controller level via `@Roles(...)`. The frontend
also hides the buttons + the sidebar entry per role but defence is
at the API.

## 6. Frontend

### New files

- `frontend/src/app/staff/leads/page.tsx` — list page with URL-state
  filters (debounced search), table (desktop) + cards (mobile),
  pagination.
- `frontend/src/app/staff/leads/[id]/page.tsx` — detail page with
  StatusCard / AssignmentCard / StatusHistoryCard (left column) +
  ScorecardCard / LeadWixPayments / AttributionCard / "Open in
  legacy sales view" (right column).
- `frontend/src/components/leads/LeadStatusChip.tsx` — 11 status
  variants, colour-coded.
- `frontend/src/components/leads/LeadSourceChip.tsx` — pattern-based
  normaliser for the free-text `sourceChannel`.
- `frontend/src/components/scorecard/ScorecardBandChip.tsx` —
  red→teal scale for Bands 1-6.

### Modified files

- `frontend/src/components/staff/shell/StaffSidebar.tsx` — added
  "Leads" entry between Cases and Meetings (sub-decision: between
  Cases and Marketing per spec — adjusted to Cases-and-Meetings
  because Meetings sits between Cases and Marketing in the existing
  nav order; functionally identical, "between Cases and Marketing"
  is preserved).
- `frontend/src/i18n/messages/{en,fa}.json` — `staff.nav.leads`
  translation key.

## 7. Validation

- Backend `npx tsc --noEmit` → clean (exit 0).
- Frontend `npx tsc --noEmit` → clean (exit 0).
- Scorecard tests: `npx jest src/scorecard/scoring/scoring.spec.ts`
  → **40 / 40 pass**.
- 4 smoke probes:
  ```
  GET    /staff/leads                  → 401
  GET    /staff/leads/abc123           → 401
  PATCH  /staff/leads/abc123/status    → 401
  PATCH  /staff/leads/abc123/assign    → 401
  ```
- Frontend page exists: `GET /staff/leads` (unauth) → 307 redirect
  to `/login?next=%2Fstaff%2Fleads`.
- Visual click-through as OWNER could not be performed because the
  OWNER credentials aren't available in this session. The route
  registration is verified via the redirect; backend endpoints are
  verified via the 4 401 probes; the type-checker confirmed every
  TSX file resolves its imports cleanly.

## 8. Skip / preserve checklist

- ✅ No new database tables.
- ✅ No new npm dependencies — verified via `git diff` on
  `package.json`.
- ✅ No new env vars.
- ✅ Existing `/leads` controller untouched.
- ✅ Existing `/sales/leads/*` routes intact.
- ✅ `LeadWixPayments` from PR-SCORECARD-4 reused without
  modification.
- ✅ 40 / 40 scorecard unit tests pass.
- ✅ d95640d JWT pattern preserved (`req.user?.userId ?? req.user?.id`).
- ✅ Mobile-first responsive (table → card stack at md breakpoint).
- ✅ Single commit.

## 9. Operational notes

- `LeadStatus` has no `CONVERTED` value — `CLOSED_WON` is the
  conversion endpoint. The `LEAD_CONVERTED` audit event fires when
  status transitions into `CLOSED_WON`.
- The status update endpoint is idempotent: setting the same
  status returns the current detail without writing a new history
  row.
- Detail view writes `LEAD_VIEWED_BY_STAFF` audit row on every
  call. Audit-write failure is logged and does not block the page —
  the audit feed is informative, not load-bearing.
- The legacy `/sales/leads/:id` page has an `LeadStatusActions`
  component that uses the older `/leads/:id` PATCH with the
  transition-validation rules from `update-lead-status.dto.ts`.
  The new `/staff/leads/:id/status` PATCH bypasses those transition
  rules — staff with the right role can set any valid enum value,
  including non-linear moves. The reasoning is that the
  legacy sales transition-validation was tuned for the funnel-bound
  flow, while the new UI is the all-states staff dashboard where
  arbitrary corrections must be possible.

## 10. Backlog (deferred to future PRs)

- Notes / comments on leads (no `LeadNote` model yet).
- Bulk actions: status change / reassign for multiple leads at
  once.
- CSV export.
- Lead deduplication (multiple leads per contact email).
- Auto-claim by sales rep when the first response is sent.
- Lead scoring beyond scorecard (engagement, response time,
  recency).
- Saved filter presets ("My open leads", "Hot bands no payment").
- Real-time updates (server push / SSE so a status change made by
  one staff is visible in another's open tab without a refresh).
- Bring transition-validation rules into the staff endpoint as a
  feature flag, so OWNER/ADMIN can choose between "strict funnel"
  and "free-form correction" modes per environment.
