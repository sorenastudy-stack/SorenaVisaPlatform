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

- Frontend `tsc --noEmit` clean; `next build` OK (`/staff/admission-tasks` route compiled).
- Route existence confirmed by curl against the running backend (401 = exists+auth vs 404 = no
  route) for both the task endpoint and every corrected case-sub-resource path.

## Honest notes / follow-ups

- **No backend change** — the task endpoint and its `list`/`resolve` behaviour were reused verbatim.
- **Prefix inconsistency is broader than this tab.** The backend genuinely mixes `api/staff/...` and
  `staff/...` controllers; the frontend matches each per-endpoint today. A future normalisation pass
  (pick one convention app-wide) would remove this footgun, but that's a cross-cutting cleanup, not
  this slice.
