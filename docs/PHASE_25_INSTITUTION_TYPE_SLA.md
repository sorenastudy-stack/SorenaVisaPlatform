# Phase 25 — Owner-Manageable, Institution-Type Stage SLAs (Fork C)

End-of-phase handover for the stage **SLA / deadline system** — Phase 22's deferred
"Fork C", now built, and per the update: the durations are **manageable by the Owner
through the system** (not hardcoded) and **vary by institution type** (University /
Polytechnic / College).

**Date:** 2026-07-27
**Commit (this phase):**
- `e01a1ba` — feat(sla): Owner-manageable, institution-type stage SLAs + overdue kanban counter + report

---

## 1. What this phase does

Every active case now has a **stage deadline** and an **overdue day-counter**, driven
by an **Owner-editable** config that **varies by institution type**:

- **`SlaConfig`** — one editable row per `{institutionType, stage}` → `slaDays` +
  `isWorkingDays`. Seeded with the launch defaults:
  - **ADMISSION — 25 working days** (weekends skipped)
  - **VISA — 30 calendar days**
  - **INZ_SUBMITTED — 2 calendar days**
  - identical across University / Polytechnic / College (the point is independent
    *editability*, not that they differ today).
- **A case's deadline** = `stageEnteredAt + slaDays` for its institution type × current
  stage (working- or calendar-days), unless a per-case `stageDeadlineOverride` is set
  (that wins). Terminal stages (COMPLETED/WITHDRAWN) have no deadline.
- **Institution type** is resolved from the case's **accepted (or most-recent)
  application's `provider.providerType`**, falling back to `UNIVERSITY` when a case has
  no application yet.
- **Editing a row at `/staff/settings/sla` changes the calc immediately** — no deploy.
- **Overdue surfaces two ways:** a red "N days overdue" counter on the CO kanban case
  cards, and an **overdue-by-Client-Officer report** at `/staff/sla-report`.

## 2. Files created or changed

Pulled from `git show --stat e01a1ba`.

*Created*
- `backend/prisma/migrations/20260727150000_pr_sla_config/migration.sql` — columns +
  `sla_configs` table + backfill + the 9 seed rows.
- `backend/src/sla/sla.service.ts` — institution-type resolution, deadline/overdue
  computation, config CRUD, the by-officer report.
- `backend/src/sla/sla.controller.ts` — `GET/PATCH /staff/settings/sla`,
  `GET /staff/sla-report`; `dto/sla.dto.ts`; `sla.module.ts`; `sla.spec.ts`.
- `frontend/src/app/staff/settings/sla/page.tsx` + `components/staff/sla/SlaSettingsClient.tsx`.
- `frontend/src/app/staff/sla-report/page.tsx` + `components/staff/sla/SlaReportClient.tsx`.

*Changed*
- `backend/prisma/schema.prisma` — `SlaConfig` model; `Case.stageEnteredAt`,
  `Case.stageDeadlineOverride`.
- `backend/src/cases/inz-submission/inz-submission.service.ts`,
  `backend/src/cases/visa/visa.service.ts`,
  `backend/src/legal-notes/legal-notes.service.ts` — stamp `stageEnteredAt = now` at
  the 5 stage-transition writes.
- `backend/src/kanban/kanban.service.ts` + `kanban.module.ts` — case cards carry
  deadline / daysOverdue / overdue (via `SlaService`).
- `backend/src/app.module.ts` — register `SlaModule`.
- `frontend/src/components/staff/kanban/KanbanClient.tsx` — red overdue counter on case cards.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — "Overdue cases" + "Stage SLAs" nav.

## 3. Database tables / columns added

- **`sla_configs`** — `{ institutionType (ProviderType), stage (CaseStage), slaDays,
  isWorkingDays, updatedAt, updatedById }`, unique on `(institutionType, stage)`.
  Seeded with 9 rows (3 institution types × ADMISSION/VISA/INZ_SUBMITTED).
- **`cases.stageEnteredAt`** (DateTime?) — when the case entered its current stage;
  existing rows **backfilled to `updatedAt`** (best available proxy).
- **`cases.stageDeadlineOverride`** (DateTime?) — optional manual per-case deadline.

## 4. Environment variables added (names only)

**None.** The SLA numbers live in the DB, not env — that's the point (Owner-editable).

## 5. Third-party services connected

**None.**

## 6. How to test it works

**Automated** — `sla.spec.ts` (DB-backed, 6/6 green): ADMISSION deadline uses working
days; an aged VISA case is overdue with the correct day-count; **editing a stage's SLA
changes the calc** and **University vs Polytechnic are independent**; a manual
override wins; the report groups overdue cases by officer; out-of-range days rejected.
The Phase 24 co-kanban spec (5) still passes. Backend `tsc` + `next build` clean.

**Manual:**
1. As OWNER, open **Stage SLAs** (`/staff/settings/sla`) — a table of institution type
   × stage with editable day-counts. Change University · Admission and save.
2. A University case in Admission now uses the new number for its deadline; a
   Polytechnic case is unaffected.
3. Open **My clients** (`/staff/kanban`) — case cards past their stage SLA show a red
   "N days overdue" badge.
4. Open **Overdue cases** (`/staff/sla-report`, OWNER/ADMIN) — overdue cases grouped by
   Client Officer, click through to the case file.
5. Set a case's `stageDeadlineOverride` (extension) → it drops off overdue.

## 7. Known limitations / future work

- **Stage-entry stamping is forward-looking.** `stageEnteredAt` is stamped at
  transitions from this phase on; existing cases were backfilled to `updatedAt` (a
  proxy — last activity, not true stage entry). Cases created before this phase may
  show a slightly-off "days in stage" until they next transition.
- **Case creation uses the `createdAt` fallback**, not an explicit stamp (a new case in
  ADMISSION correctly measures from creation). Only the 5 *transition* writes stamp.
- **Institution type = one application's provider.** A case with multiple applications
  across providers uses the accepted (else most-recent) one; there's no per-application
  SLA. A case with no application yet falls back to `UNIVERSITY`.
- **`SCHOOL` provider type is not seeded** (the brief named University/Polytechnic/
  College). A `SCHOOL` case falls back to the `UNIVERSITY` config; add a row + seed if
  schools need distinct SLAs.
- **Only `slaDays` is editable** in the screen; `isWorkingDays` is a per-stage property
  set at seed time (ADMISSION working, VISA/INZ calendar). Make it editable if a stage
  ever needs to switch.
- **No deadline-extension *approval* workflow.** The `stageDeadlineOverride` field
  exists and wins, but setting it isn't yet gated behind an approval (Phase 22 also
  mentioned "deadline-extension approval") — that's a further follow-up.
- **The report is live-computed** (no snapshot/history of overdue over time).

## 8. How a future developer would extend this

- **Different SLA per institution type:** just edit the numbers at `/staff/settings/sla`
  — no code. To add `SCHOOL`, insert 3 rows (or seed) + it appears in the table.
- **Editable working/calendar toggle:** add `isWorkingDays` to the PATCH DTO +
  `updateConfig` + the settings screen.
- **Deadline-extension approval:** gate writes to `stageDeadlineOverride` behind the
  existing owner-approval queue.
- **Time-in-stage analytics / history:** the deferred `CaseStageTransition` table would
  add per-stage durations; `stageEnteredAt` is the first step toward it.
- All calc lives in `SlaService.computeForCases` (single source); surfaces (kanban,
  report) call it — add new surfaces by calling the same method.

## 9. Security layers applied

- **Config editing is OWNER/SUPER_ADMIN only** (`/staff/settings/sla`), enforced at the
  controller + the frontend page gate; `updateConfig` validates the range (0–365) and
  records `updatedById`.
- **The report is OWNER/ADMIN/SUPER_ADMIN** — it exposes cross-officer case data, so
  it's owner-tier, not CO-facing.
- **The kanban SLA fields are read-only** derived values; a CO sees their own cases'
  overdue state but can't change stages or deadlines from the board.
- **No new secrets / PII surface** — SLA numbers + computed deadlines only.

## 10. Rollback instructions

Additive migration — a straight git revert; columns/table can stay.

1. **Full revert:** `git revert e01a1ba`. Removes the SLA module + pages + nav, the
   kanban overdue fields, and the `stageEnteredAt` stamping. The `sla_configs` table +
   the two `cases` columns remain in the DB (additive, unused) — drop separately if
   desired.
2. **Partial (keep calc, hide surfaces):** remove the two sidebar items + the
   `/staff/settings/sla` and `/staff/sla-report` pages; the endpoints + kanban fields
   stay.
3. **No env/service cleanup** — there is none; the SLA numbers live in `sla_configs`.
