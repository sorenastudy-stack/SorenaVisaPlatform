# PHASE-H — Replace every "Coming soon" placeholder with real content

Launch requirement: no placeholder pages ship. Every staff-portal "Coming soon"
surface now shows the person's real work, or an honest, warm empty state — never
"Coming soon". Zero "Coming soon" strings remain in the English/code surface
(Persian is frozen and untouched).

## 1. What this PR does

- **Staff Overview (`/staff`)** — real per-role landing: the ops dashboard for
  the admin tier, a personalized launchpad for everyone else.
- **Staff Meetings (`/staff/meetings`)** — the signed-in user's own consultation
  sessions (Upcoming / Past), read-only, from an already-scoped endpoint.
- **Case-detail Meetings / Tickets tabs** — honest pointer panels to the real
  Meetings / Tickets surfaces (no per-case endpoint exists).
- **Sales Pipeline / Consultations / Commissions** — warm, honest empty states
  (surfacing the available data would breach entitlement — see §7).
- **Finance Training & News** — honest empty state (no CMS behind it).
- Deleted the generic `PlaceholderPanel`; reworded every remaining "coming soon"
  string (dead i18n keys, tooltips, save-banners, code comments) so a codebase
  grep returns zero.

**No new backend.** Overview and Meetings reuse existing JWT-scoped endpoints;
nothing accepts a `userId` param; no new read endpoint (so no new throttle
surface).

## 2. Files changed

**Frontend — new**
- `components/staff/overview/StaffOverviewClient.tsx` — dashboard + launchpad.
- `components/staff/meetings/StaffMeetingsClient.tsx` — my-meetings view.

**Frontend — rewired / rewritten**
- `app/staff/page.tsx`, `app/staff/meetings/page.tsx` — render the new clients.
- `app/sales/{pipeline,consultations,commissions}/page.tsx` — empty states.
- `app/staff/finance/training/page.tsx` — empty state copy.
- `components/staff/cases/detail/CaseDetailClient.tsx` — `TabPointer` replaces
  `PlaceholderPanel` on the Meetings / Tickets tabs.
- `components/staff/PlaceholderPanel.tsx` — **deleted**.

**Frontend — copy only (drop "coming soon")**
- `i18n/messages/en.json` (tooltip, 9 visa save-banners, dead placeholder keys),
  `lib/scorecard/labels.ts`, and 8 code comments (admin/*, student/case,
  AssessmentReportCard, PortalLayout, ChatbotCard, MeetingsCard).

**Backend** — one comment reword (`students/students.service.ts`).

**Test (local-only, gitignored):** `backend/scripts/test-placeholder-pages.ts`.

## 3. Staff Overview — how the two modes are chosen

The client calls `GET /api/staff/cases/dashboard`. That endpoint is gated to the
SEE_ALL tier (OWNER / SUPER_ADMIN / ADMIN) server-side.
- **200** → dashboard mode: active cases by stage, the attention worklist
  (unassigned LIA / high-risk / hard-stop / escalation, each linking to the
  case), and recent case activity.
- **403** → launchpad mode: a personalized set of quick-links to the sections
  that role can actually reach (LIA / CONSULTANT / SUPPORT / CLIENT_CONSULTANT).

Entitlement stays enforced by the server; the UI never assumes a role — it reacts
to what the endpoint returns. (FINANCE is redirected to `/staff/finance` before
this page, unchanged.)

## 4. Staff Meetings — scoping

Reads `GET /staff/bookings`, which the service scopes to
`assignedToId = req.user.userId` (admin tier sees all). The client sends **no
userId** — a bare GET. A LIA therefore sees only their own sessions. Roles not
entitled to the bookings endpoint get a 403, which the client treats as "no
meetings" (warm empty state), never an error wall. Read-only by design; the
mark-no-show / complete / cancel actions live on `/staff/bookings`.

## 5. Configuration

None. No new env, no new endpoint, no schema change, no migration.

## 6. How to test

- **`scripts/test-placeholder-pages.ts` — 16/16.** Zero "coming soon" in
  en/code; Overview hits the scoped dashboard + 403→launchpad + no userId;
  Meetings reads `/staff/bookings` with no userId and splits upcoming/past;
  sales pages carry no "coming soon" and do **not** call the unscoped
  `/leads`/`/commissions`; case tabs use `TabPointer`; `PlaceholderPanel`
  deleted; finance training is a role-gated empty state.
- **Grep proof:** `grep -rniE "coming soon" frontend/src backend/src` (excluding
  `fa.json`) → **0 matches**.
- `tsc` clean (frontend 0); `nest build` clean; `next build` clean with all six
  routes registered.
- **Backend behaviour** (dashboard shape, bookings `assignedToId` scoping) is
  covered by the existing staff-cases / staff-bookings specs — reused, not
  re-implemented.

## 7. Known limitations / decisions for you

These are the surfaces where surfacing data would have been wrong, so they are
honest empty states — flagged for a product/security call:

- **`GET /leads` and `GET /commissions` are unscoped.** Both return **all** rows
  to any authenticated user (no role gate, no per-user filter). Building the
  Sales Pipeline/Commissions on them would show a sales rep the entire funnel /
  everyone's payouts — a breach of "only what the user is entitled to see." They
  are empty states until those endpoints are scoped (`/commissions/mine`, a
  role-gated `/leads`). **Recommend: add server-side scoping before wiring the
  UI.**
- **The `/sales` portal is legacy.** SALES is the *default* role (`@default(SALES)`)
  but modern staff surfaces (e.g. `/staff/leads`) exclude it. Decide: wire
  `/sales` to scoped endpoints, or retire it (route SALES → `/staff` like the
  other roles, and/or change the default role).
- **No per-case Meetings/Tickets endpoint.** `VisaSupportTicket` has a `caseId`
  column but the staff list has no `caseId` filter, and consultations link to a
  case only transitively (via lead). The case-detail tabs point to the global
  Meetings/Tickets surfaces rather than claim "none". A real per-case list would
  be a small filter add — say the word.
- **Finance Training & News** has no CMS/model at all — genuinely nothing to
  show; empty state until content management exists.
- **Persian is frozen.** English copy dropped "coming soon"; the mirrored
  `fa.json` values still read "به‌زودی". No `fa` entries were added or changed
  per the freeze — re-translate when Persian unfreezes.

## 8. How to extend

- **Meetings link on cases:** add a `caseId` filter to `staff-tickets.service`
  and a case→lead→consultations query, then swap the two `TabPointer`s for real
  lists.
- **Sales real data:** once `/leads`/`/commissions` are scoped, replace the
  empty states with grouped lists (the empty-state components are drop-in).
- **Overview per-role depth:** the launchpad `ROLE_SHORTCUTS` map is the single
  place to add/adjust a role's quick-links.

## 9. Security applied

- **Server-enforced entitlement, everywhere.** Overview reacts to a real 403;
  Meetings relies on `assignedToId = JWT` scoping; no page trusts a client-side
  role for data access.
- **No userId params.** Both new clients call JWT-scoped `/me`-style endpoints
  with no identifiers in path/query/body — a user cannot request another user's
  meetings or dashboard.
- **Refused to surface unscoped data.** `/leads` and `/commissions` were left
  unwired specifically because they lack server-side scoping (documented above),
  rather than shipping a leak.
- **No new attack surface.** No new endpoints, so nothing new to rate-limit; the
  existing global 60/min ThrottlerGuard covers the reused reads.

## 10. Rollback procedure

- **Code:** revert the commit. The new Overview/Meetings clients and the
  `TabPointer`/empty-state pages disappear; there is no data or schema change to
  unwind. (`PlaceholderPanel` would return with the revert.)
- **No backend/DB impact** — this PR is frontend + copy only (one backend
  comment). Nothing to migrate or reseed.
- **Order:** frontend-only; deploy/rollback independently of the backend.
