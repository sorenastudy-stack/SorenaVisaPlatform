# PR-ADMISSION-TASKS-UI — the cross-case admission task queue + an API-prefix fix

**Status:** BUILT + VERIFIED (2026-08-03). Closes the long-standing gap where the AdmissionTask
system (GET `/staff/admission-tasks`, since PR-INTAKE-1) had no UI at all.

## The queue page

A single **"My admission tasks"** page (`/staff/admission-tasks`, nav entry + session gate, curator
roles) that surfaces **all three task types together**, not just follow-ups:

- **`SUBMISSION_FOLLOW_UP`** (Step 5 — the 5-working-day institution follow-up),
- **`INTAKE_REASSIGNED`** / **`INTAKE_REASSIGN_FAILED`** (the older Intake-Timing tasks).

Reuses the existing endpoint **as-is** (no backend change): default view = the caller's tasks + the
unassigned queue; admins get a "Show all" toggle (`?scope=all`). Urgent-first, then oldest. Each row
shows a type badge, urgent/unassigned flags, the title, the student, a link to the case, and a
**Done** action (PATCH `/:id/resolve`). Follow-up tasks also auto-clear when the response is logged
on the case (Step 5) — the queue's Done button is the manual path.

## The API-prefix fix (a latent bug found while wiring this page)

The backend has **no global prefix**; each controller declares its own path, and the case
**sub-resource** controllers deliberately use `staff/cases/:caseId/...` (no `api/`) — this is a
consistent convention across `cv`, `sop`, `submissions`, `employment-entries`, `programme-choices`,
and the pre-existing `recommendations`. But `CaseAdmissionsTab.tsx` was calling them at
**`/api/staff/cases/...`**, which the backend serves at `/staff/cases/...` — so every Admissions-tab
API call (employment, programme choices, **CV, SOP, submissions**) was hitting a **404 in-browser**.
The tab hadn't been exercised in a live browser yet (the portal is being built step-by-step, not yet
live), so the golden/integration/build checks — which never hit these HTTP routes — all passed.

**Fix:** normalised `CaseAdmissionsTab`'s calls from `/api/staff/cases/...` → `/staff/cases/...`
(one file, 17 call sites), matching the actual routes and the sub-resource convention. Verified each
route exists at the no-`api` path (e.g. `/staff/cases/:id/cv` → 401 auth, `/api/staff/cases/:id/cv`
→ 404). The Step 2b–5 Admissions UI is now actually reachable.

## Verification

- **Authenticated end-to-end HTTP round-trip (13/13)** through the live Nest stack (guards →
  controller → service → DB) with a genuine `/auth/login` token, exercising every Admissions-tab
  endpoint + the task-queue endpoint and asserting **real payloads**, not just status codes:
  programme-choices list, employment create+read, CV generate (facts from rows), SOP generate
  (frame localized to the chosen provider + all 3 gates present), submission create → record
  response (→ OFFER) → list, and `GET /staff/admission-tasks`. (CV/SOP ran the AI-unavailable path —
  no `ANTHROPIC_API_KEY` in the env — so facts assembled and gates failed closed, as designed.)
- New route registered + auth-gated: `/staff/admission-tasks` → 307 `/login?next=…` (curl).
- Frontend `tsc --noEmit` clean; `next build` OK (route compiled).
- **NOT confirmed:** a GUI/visual browser render pass. This is a headless CLI session and Chrome
  could not be installed for Playwright (needs admin). So the React DOM *painting* the returned data
  was not visually verified — only that the data it consumes and the routes it calls are correct.
  A human visual pass (or a browser-automation run in an env with Chrome) is the remaining step.

## Process learning (not a one-off — applies to Step 6 onward)

The Admissions-tab prefix bug survived four "verified" checkpoints (Steps 2b–5) because the
verification was **`tsc` + `next build` + backend-service smokes** — none of which exercise the
frontend→backend HTTP path. **"tsc clean + build OK" is NOT evidence that a feature with API calls
works.** Going forward, any step that adds or changes frontend API calls must include, as part of
the *verified* claim, at least one of:

1. a **real click-through** in a browser (or headless browser automation) that shows the data
   rendering and the network calls returning 2xx, **or**
2. an **HTTP-level check** — an authenticated request to each new/changed route asserting a real
   response (like the 13/13 round-trip above, or the curl 401-vs-404 route probes).

A build that compiles only proves the code type-checks, not that a single request resolves.

## Honest notes / follow-ups

- **No backend change** — the task endpoint and its `list`/`resolve` behaviour were reused verbatim.
- **Prefix inconsistency is broader than this tab.** The backend genuinely mixes `api/staff/...` and
  `staff/...` controllers; the frontend matches each per-endpoint today. A future normalisation pass
  (pick one convention app-wide) would remove this footgun, but that's a cross-cutting cleanup, not
  this slice.
