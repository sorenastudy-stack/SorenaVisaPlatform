# PR-CONSULT-2 — Staff dashboard shell, cases list and detail

Handover for the first staff-facing UI on top of the PR-CONSULT-1 foundation. Lands on `main` ahead of further consultant-side UI PRs.

## 1. What this PR does

The 7 staff roles introduced in PR-CONSULT-1 (`OWNER`, `SUPER_ADMIN`, `ADMIN`, `LIA`, `CONSULTANT`, `SUPPORT`, `FINANCE`) now have a usable portal at `/staff`. Signing in as any of them lands on a shell with a navy sidebar (desktop) / bottom tab bar (mobile), a top bar with the user's name + role badge + sign-out button, and a real **Cases** section that lets staff browse the cases visible to them, open a case, see the four assignment slots, and (for admin tier) reassign any slot using the existing `/api/staff/assignments/manual-assign` endpoint.

Every other section in the sidebar — Overview, Meetings, Tickets, Staff (admin-tier-only), Approvals (OWNER + SUPER_ADMIN only) — renders a "Coming soon" placeholder. They exist so the nav is complete and ramping up later PRs is purely additive; nothing in this PR pretends to ship features it doesn't have.

The role gate on `/unauthorized` is unchanged at the page level — instead the **middleware** for `/staff/*` now allows the 7 staff roles, and post-login redirect routes them to `/staff` instead of the per-role legacy shells. Students still go to `/student/dashboard`. The legacy `/admin`, `/ops`, `/sales`, `/lia` routes keep working for direct navigation.

## 2. Files changed

Backend (new):
- `src/common/audit/audit.helper.ts` — `summarizeAuditEntry(entry)` producing a one-line human string per `eventType`. Covers `STAFF_ASSIGNED_AUTO/MANUAL/REASSIGNED`, `MEETING_*`, `TICKET_*`, `CHAT_ESCALATION_ACCEPTED`, `STATUS_CHANGED`, `STEP_*`, `DOCUMENT_*`, with a humanise-the-event-type fallback for unknown values.
- `src/staff/me/` — `staff-permissions.ts` (`staffPermissions(role)` helper exposing `canManageStaff` / `canApprove` / `canSeeAllCases` / `canReassign`), `staff-me.service.ts`, `staff-me.controller.ts`, `staff-me.module.ts`. Single `GET /api/staff/me` endpoint.
- `src/staff/cases/` — `staff-cases.service.ts`, `staff-cases.controller.ts`, `staff-cases.module.ts`, `dto/staff-cases.dto.ts`. Three endpoints: `GET /`, `GET /:id`, `GET /:id/activity`.

Backend (existing):
- `src/staff/staff.module.ts` — imports `StaffMeModule` + `StaffCasesModule`.

Frontend (new under `src/`):
- `contexts/StaffContext.tsx` — `StaffProvider` + `useStaff()`. Fetches `/api/staff/me` on mount, exposes `{ me, permissions, loading, error, refresh }`.
- `components/staff/shell/` — `StaffShell.tsx`, `StaffSidebar.tsx`, `StaffBottomTabs.tsx`, `StaffTopBar.tsx`, `StaffRoleBadge.tsx`, `PermissionGate.tsx`.
- `components/staff/PlaceholderPanel.tsx` — generic "Coming soon" panel with an optional `section` label.
- `components/staff/cases/` — `CaseStatusPill.tsx`, `CasesPageHeader.tsx`, `CasesTable.tsx`, `CasesGrid.tsx`, `CasesPagination.tsx`, `CasesPageClient.tsx`, `useCasesQuery.ts`.
- `components/staff/cases/detail/` — `types.ts`, `CaseHeader.tsx`, `CaseAssignmentsPanel.tsx`, `ReassignOverlay.tsx`, `CaseTabs.tsx`, `CaseOverviewTab.tsx`, `CaseActivityTab.tsx`, `CaseDetailClient.tsx`.
- `app/staff/` — `layout.tsx`, `page.tsx`, `cases/page.tsx`, `cases/[id]/page.tsx`, `meetings/page.tsx`, `tickets/page.tsx`, `users/page.tsx`, `approvals/page.tsx`.

Frontend (existing):
- `middleware.ts` — added `/staff` to `ROLE_ROUTES` (all 7 staff roles) and to the matcher.
- `app/login/page.tsx` — `ROLE_REDIRECT` now sends `OWNER`/`SUPER_ADMIN`/`ADMIN`/`LIA`/`CONSULTANT`/`SUPPORT`/`FINANCE` to `/staff`. Students still go to `/student/dashboard`. Legacy `OPERATIONS` and `SALES` keep going to `/ops` and `/sales`.
- `i18n/messages/en.json` + `fa.json` — 42 new keys under `staff.*` (nav labels, role labels, coming-soon strings, cases list + detail copy).

No schema changes. No new env vars. No new dependencies.

## 3. Backend endpoints

All routes are gated by `JwtAuthGuard + StaffRolesGuard` (per PR-CONSULT-1 conventions). The new guard already enforces the active-status check via `StaffActiveStatus`.

### `GET /api/staff/me`

Roles: any of the 7 staff roles.

Response:
```json
{
  "id":       "cmpep...",
  "email":    "owner@sorenastudy.com",
  "fullName": "Owner Name",
  "role":     "OWNER",
  "isActive": true,
  "permissions": {
    "canManageStaff": true,
    "canApprove":     true,
    "canSeeAllCases": true,
    "canReassign":    true
  }
}
```

The four permission booleans come from `staffPermissions(role)` in `staff-permissions.ts`. The frontend uses them via `<PermissionGate require="canReassign">...</PermissionGate>` and via filter calls in the sidebar / bottom-tab components.

### `GET /api/staff/cases`

Roles: any of the 7 staff roles.

Query parameters:
- `status` — optional, one of the `VisaCaseStatus` enum values.
- `assignedToMe` — `true`/`false`. When `true`, narrows to cases where the caller holds an active assignment (regardless of tier).
- `q` — free-form substring matched against `User.name` and `User.email` of the case's client (case-insensitive).
- `page` — defaults to 1.
- `pageSize` — defaults to 20, max 100.

Visibility rule (enforced server-side):
- `OWNER` / `SUPER_ADMIN` / `ADMIN` → all cases.
- `LIA` / `CONSULTANT` / `SUPPORT` / `FINANCE` → only cases where they hold an active `VisaCaseAssignment` in any slot.

Response shape:
```json
{
  "items": [
    {
      "id":           "case_id",
      "studentId":    "user_id",
      "studentName":  "Jane Doe",
      "studentEmail": "jane@example.com",
      "status":       "DRAFT",
      "stage":        "DRAFT",
      "createdAt":    "...",
      "updatedAt":    "...",
      "assignedLia":        { "id": "...", "name": "..." } | null,
      "assignedConsultant": { "id": "...", "name": "..." } | null
    }
  ],
  "total":    127,
  "page":     1,
  "pageSize": 20
}
```

Sorted by `updatedAt DESC`. `stage` mirrors `status` — `VisaCase` doesn't have a separate stage column; a later PR can split them if needed.

### `GET /api/staff/cases/:id`

Roles: any of the 7 staff roles. Returns 404 (not 403) when the case isn't visible to the caller — same convention as the rest of the platform.

Response:
```json
{
  "id":        "...",
  "status":    "DRAFT",
  "stage":     "DRAFT",
  "createdAt": "...",
  "updatedAt": "...",
  "student": {
    "id":        "...",
    "firstName": "Jane",
    "lastName":  "Doe",
    "email":     "...",
    "locale":    "en",
    "phone":     "+64..." | null
  },
  "assignments": {
    "LIA":        { "id": "...", "name": "...", "role": "LIA" } | null,
    "CONSULTANT": { ... } | null,
    "SUPPORT":    { ... } | null,
    "FINANCE":    { ... } | null
  }
}
```

`firstName` / `lastName` split on the first whitespace from the user's `name` field (matches the student-dashboard heuristic). `locale` comes from the linked `Contact.preferredLanguage`, falling back to `en`. `phone` from `Contact.phone`, nullable.

### `GET /api/staff/cases/:id/activity`

Roles: any of the 7 staff roles. Visibility same as the detail endpoint (404 when invisible).

Response: array of up to 50 audit-log entries, newest first.
```json
[
  {
    "id":         "audit_id",
    "eventType":  "STAFF_REASSIGNED",
    "actorName":  "Owner Name" | null,
    "actorRole":  "OWNER" | null,
    "createdAt":  "...",
    "summary":    "LIA slot reassigned to a new staff member"
  }
]
```

Implementation pulls up to 200 candidate rows from `audit_logs` filtered by relevant entity types (`VisaCase`, `VisaCaseAssignment`, `VisaSupportTicket`, `VisaSupportTicketMessage`, `VisaMeeting`, `VisaCaseFileNote`), then filters in-memory to rows whose `newValue` / `oldValue` JSON blob carries `caseId === :id`, then takes the most recent 50. This avoids depending on a database-specific JSON-path query while keeping the result bounded.

## 4. Frontend architecture

### Routes (locale-flat, no `[locale]` segment)

- `/staff` — Overview placeholder.
- `/staff/cases` — Cases list.
- `/staff/cases/[id]` — Case detail.
- `/staff/meetings` — placeholder.
- `/staff/tickets` — placeholder.
- `/staff/users` — placeholder, ADMIN+ only (server-side `redirect('/staff')` if a non-admin lands here).
- `/staff/approvals` — placeholder, OWNER + SUPER_ADMIN only.

The shared layout (`app/staff/layout.tsx`) is a server component that:
1. Reads the session via `getSession()`, redirects to `/login?next=/staff` if absent.
2. Redirects to `/unauthorized` if the role isn't one of the 7 staff roles.
3. Wraps children with `<StaffShell>`, which itself wraps them with `<StaffProvider>`.

### StaffContext

`<StaffProvider>` fires a single `GET /api/staff/me` on mount, exposes `{ me, permissions, loading, error, refresh }`. Components consume it via `useStaff()`. The provider is mounted by `StaffShell.tsx`, so anything rendered under the `/staff` layout has access to it.

### PermissionGate

```tsx
<PermissionGate require="canManageStaff">
  <NavItem ... />
</PermissionGate>
```

Renders children when the requested permission is `true`, otherwise renders an optional `fallback` (default `null`). Used by the sidebar nav, the bottom-tab bar, and the assignments panel's "Reassign" button.

### Cases list

`CasesPageClient` owns search / status / assigned-to-me / page state. `useCasesQuery` is a small hook that:
- Debounces search by 300ms.
- Re-fires the query when any non-search filter changes.
- Tracks a request sequence number so stale responses don't overwrite fresh ones.

View mode is stored in `localStorage` key `sorena.staff.casesViewMode`. The default branches on viewport (`table` on `>= 1024px`, `card` below), but once the user picks a mode it sticks for that browser.

### Case detail

`CaseDetailClient` fetches `/api/staff/cases/:id` on mount, renders header → assignments panel → tab strip → tab content. The Reassign overlay calls `onChanged()` after a successful submit, which triggers a re-fetch of the case detail so the assignments panel reflects the new assignee. The Activity tab fires its own `GET /api/staff/cases/:id/activity` and renders the server-side summaries verbatim.

## 5. UI rules applied

- Navy `#1e3a5f` primary, gold `#c9a961` accent, off-white `#faf8f3` background.
- Sidebar 240px wide on desktop. Bottom tab bar 64px tall on mobile.
- Active sidebar item: gold left-border + lighter bg. Active bottom tab: navy icon + text.
- Role badges: OWNER gold/navy, SUPER_ADMIN navy/off-white, ADMIN slate-700/white, LIA/CONSULTANT/SUPPORT/FINANCE gray-100/gray-800.
- All clickable elements ≥48px (`min-h-[48px]` on buttons / inputs / nav items).
- Border radius 12px (`rounded-xl`) for buttons, 16px (`rounded-2xl`) for cards/overlays.
- One primary action per screen.
- Inline overlay modals only — `ReassignOverlay` is a hand-rolled fixed-position element, not a `Dialog` component.
- RTL handled by the existing `LocaleProvider` flipping `<html dir="rtl">` when fa is active.

## 6. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **OWNER sign-in:** sign in as an OWNER user → land on `/staff` Overview placeholder. Top bar shows gold "Owner" badge. Sidebar lists all 6 nav items including Staff and Approvals.
3. **Lower-tier sign-in:** sign in as a LIA / CONSULTANT / SUPPORT / FINANCE → land on `/staff`. Top bar shows gray role pill. Sidebar shows 4 nav items (no Staff, no Approvals).
4. **ADMIN sign-in:** sign in as an ADMIN → land on `/staff`. Sidebar shows Staff (slate badge) but not Approvals.
5. **Cases visibility:** as OWNER/SUPER_ADMIN/ADMIN, `/staff/cases` shows every `VisaCase`. As a LIA holding a single assignment, the list shows only that case.
6. **Search:** type a partial student name or email — debounce settles within ~300ms and the list filters.
7. **Status filter:** pick a `VisaCaseStatus` from the dropdown — list narrows.
8. **Assigned to me toggle:** even as OWNER, ticking the box scopes the list to cases where you specifically hold an active assignment.
9. **View toggle:** flip between Table and Cards — selection persists across reloads (verify `localStorage.getItem('sorena.staff.casesViewMode')`).
10. **Case detail:** click a row → land on `/staff/cases/<id>`. Header shows student name + status pill, assignments panel shows all 4 slots.
11. **Reassign (admin tier):** click "Reassign" on any slot → overlay opens with candidate list. Each candidate shows their current open-assignment count. Select one + confirm → panel refreshes with new name. Audit log row appears under Activity tab on next load with summary "<SLOT> slot reassigned to a new staff member".
12. **Reassign (non-admin):** as LIA, the "Reassign" buttons should not render.
13. **Activity tab:** any STAFF_ASSIGNED_* / STATUS_CHANGED / DOCUMENT_* / STEP_* / MEETING_* / TICKET_* event on the case should appear with a human summary + actor name + role + relative time.
14. **Placeholder tabs:** Documents, Meetings, Tickets render the "Coming soon — <Section>" panel.
15. **Locale toggle:** click the EN/فا button in the top bar → page switches direction + all `staff.*` keys render in Persian. Sidebar nav, top-bar Sign Out button, and case-list copy all update.
16. **Direct URL gating:**
    - As LIA, browse to `/staff/users` → server-side redirect to `/staff`.
    - As ADMIN, browse to `/staff/approvals` → redirect to `/staff`.
    - As STUDENT, browse to `/staff` → middleware redirects to `/unauthorized`.
17. **Sign out:** click "Sign out" → `/api/auth/logout` clears the cookie, router pushes to `/login`.

## 7. Known limitations

- **All of Meetings, Tickets, Documents, Staff CRUD UI, and Approvals UI are placeholders** pending later PRs. The page chrome renders but the section bodies are the "Coming soon" panel.
- **`stage` mirrors `status` on the cases list.** `VisaCase` doesn't have a separate stage column today — only `status`. A later PR can split the lifecycle if a need emerges (e.g. mapping `VisaCase.status` onto a derived stage column for the CRM funnel).
- **Activity tab filters candidate audit rows in-memory.** For cases with hundreds of audit rows, the 200-row pre-filter window may occasionally miss an old entry. A future PR can replace the in-memory filter with a raw-SQL JSON-path query (`->>'caseId' = $1`) once Prisma's JSON filter support matures or once we accept a single Postgres-specific raw query in this code path.
- **Search hits unencrypted `User.name` + `User.email` only.** Identity fields stored encrypted on `VisaApplication` (passport name, etc.) are not searchable. Adding encrypted-field search needs a deterministic-encryption / hashed-blind-index column — out of scope for this PR.
- **No bulk-action affordance on the cases list.** Clicking a row goes to detail; there's no multi-select. The next phase can add a checkbox column when there's a need (bulk reassign? bulk status change?).
- **No "case detail" deep-link from elsewhere yet.** The student dashboard's `CaseStatusCard` and the existing consultant meetings page don't link into `/staff/cases/<id>`. Adding those links is a one-line change per consumer and can land alongside whatever PR builds out those flows.
- **Mobile case-detail layout is functional but dense.** The tab strip scrolls horizontally when the screen is narrow; the assignments panel stacks naturally. A polish pass once the placeholder tabs are real may want to fold the assignments panel into an accordion under a "Case meta" header.

## 8. How to extend

- **Add a new sidebar nav item.** Append an entry to the `NAV` array in `StaffSidebar.tsx` (and `StaffBottomTabs.tsx` if you want it on mobile). Set the optional `gate` to a permission key if it should be hidden for some roles. Add the matching i18n key to `staff.nav.*` in both `en.json` and `fa.json`.
- **Add a new permission.** Extend `StaffPermissions` in `staff-permissions.ts` + the duplicate type in `StaffContext.tsx`. Add the derivation in `staffPermissions(role)`. Use it via `<PermissionGate require="newKey">` or `useStaff().permissions.newKey`. Don't forget to enforce the same check server-side on whichever new endpoint it gates.
- **Add a new tab to the case detail.** Add an entry to the `TABS` array + the `CaseTab` union in `CaseTabs.tsx`. Add an i18n key under `staff.cases.detail.tabs.*`. Wire it into the switch in `CaseDetailClient.tsx`.
- **Add a new audit summary.** Extend the switch in `summarizeAuditEntry` in `common/audit/audit.helper.ts`. Hand-tuned summaries should pull context off `newValue` via the `pickString` helper.
- **Show the encrypted/decrypted student name on the case header.** Decrypt server-side in `StaffCasesService.getCaseDetail` and add the field to the response shape + types. Today we render `User.name` which is plaintext.

## 9. Security layers applied

- **Layer 1 — auth:** `JwtAuthGuard` on every route under `/api/staff/*`. The frontend layout also re-checks `getSession()` before rendering.
- **Layer 2 — role membership:** `@StaffRoles(...)` decorator + `StaffRolesGuard`. All cases endpoints accept any of the 7 staff roles; the visibility filter inside the service does the per-row scoping.
- **Layer 3 — active-status check:** inherited from PR-CONSULT-1's `StaffRolesGuard` — any caller with `StaffActiveStatus.isActive === false` is rejected before the controller runs.
- **Layer 4 — ownership leak protection:** `StaffCasesService.assertVisible` throws `NotFoundException` for invisible cases (not `ForbiddenException`), so a leaky caller can't probe which case ids exist.
- **Layer 5 — input validation:** `class-validator` DTO on the list endpoint (`StaffCasesListQueryDto`) enforces enum-status, int-coerced page / pageSize, and capped page size at 100.
- **Layer 6 — encrypted data stays encrypted in transit.** The detail endpoint doesn't decrypt any PII-encrypted column (passport names etc.); it only returns the plaintext `User.name` + `User.email`. Adding decrypted fields later requires explicit per-field decryption.
- **Layer 7 — audit summarizer is pure / sync.** No DB reads, no decrypt calls inside the per-row summary. Activity feed can run unbounded `.map()` over rows without amplifying load.
- **Layer 8 — route-level page redirects, not just middleware.** Pages that are admin-tier-only (`/staff/users`, `/staff/approvals`) re-check the session inside the page itself and redirect to `/staff` for non-admin staff, so even a stale middleware bypass would still land them on the safe page.
- **Layer 9 — frontend permission gates mirror backend checks.** Every UI affordance gated by a `PermissionGate` corresponds to a backend route that enforces the same permission at the API layer — UI-side gating is for ergonomics, not security.
- **Layer 10 — no new credentials or secrets.** This PR adds zero env vars, zero new tokens, and zero new third-party integrations.

## 10. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git revert HEAD~1..HEAD

# 2. push the revert
git push origin main
```

No DB migration, no env vars, no third-party state — the rollback is purely a code revert. The previous `/admin`, `/ops`, `/sales`, `/lia` shells remain intact and any user that was already signed in keeps working. Sessions issued during the brief window where this PR was live will still redirect to the legacy per-role shells once their next login fires (the legacy `ROLE_REDIRECT` map is restored as part of the revert).
