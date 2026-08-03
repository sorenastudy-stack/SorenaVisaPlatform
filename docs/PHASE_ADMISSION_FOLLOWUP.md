# PR-ADMISSION-FOLLOWUP — Step 5: the 5-working-day institution follow-up

**Status:** BUILT + VERIFIED (2026-08-03). Depends on Step 4 (SubmissionRecord) and the AdmissionTask
system. Keyed off `submittedAt` + a `PENDING` outcome on the latest attempt.

## Shape (a daily sweep that raises/clears an AdmissionTask)

When a submission is still `PENDING` **5 working days** after `submittedAt`, the specialist should
chase the institution. A daily cron sweep (mirroring `NurtureCronService`) raises a
`SUBMISSION_FOLLOW_UP` **AdmissionTask**; the task clears automatically when the response arrives.
Owner decisions (2026-08-03), all as recommended:

- **Working days (NZ).** "Day 5" = `submittedAt + 5 working days`, skipping weekends + NZ national
  public holidays — consistent with the ADMISSION stage-SLA convention.
- **Create a persisted task.** A `SUBMISSION_FOLLOW_UP` AdmissionTask (new enum value), so the
  follow-up lands in the specialist's task queue (via the existing `/staff/admission-tasks` API), not
  just a computed view.
- **Existing assignment convention.** `assignedToId = Case.consultantId` at creation; `null` → the
  unassigned queue — the same pattern the INTAKE tasks use.

## Canonical NZ working-days util (drift removed)

The working-days choice meant an NZ-holiday list would otherwise be duplicated. Extracted the
canonical **`src/common/working-days/nz-working-days.ts`** (`NZ_PUBLIC_HOLIDAYS`, `isNzWorkingDay`,
`addWorkingDays`) and repointed **`SlaService`** at it (behaviour-identical — `sla.spec` 7/7). Now
one holiday list feeds both PR-SLA and this follow-up.

## What shipped

- **`AdmissionTaskType.SUBMISSION_FOLLOW_UP`** (additive enum-value migration `20260803140000`).
- **Pure `follow-up.logic`** (golden **11/11**): `followUpDueDate`/`isFollowUpDue` (working-day math
  via the canonical util) and **`planFollowUpSweep`** — the idempotent, self-healing sweep plan
  (create for a due still-PENDING latest attempt with no task; resolve any open task not matching the
  current latest-PENDING record → covers responded / superseded / deleted). Non-mutating, deterministic.
- **`FollowUpService`** — `runDailySweep(now)` (injected clock) applies the plan against the DB
  (create tasks assigned to the case consultant / unassigned; resolve stale ones), and
  `resolveForRecord` for inline clearing.
- **`FollowUpCronService`** — thin `@Cron('30 9 * * *', Pacific/Auckland)` wrapper (after the
  visa-expiry 09:00 + nurture 09:15 sweeps) that never throws out of the scheduler.
- **Inline resolution:** `SubmissionService.recordResponse` (outcome leaves PENDING) and `remove`
  call `resolveForRecord`, so the task clears the moment the specialist acts — the daily sweep is the
  backstop. `SubmissionService.list` now derives **`followUpDue`** per choice (same rule the sweep
  uses) for the Case File.
- **UI:** a **"Follow-up due"** badge on the Case File Submission-log choice header when the latest
  attempt is overdue-PENDING. (There is no admission task-list *page* in the frontend yet — the
  AdmissionTask API is backend-only so far; a cross-case queue view is a separate surface.)

## Verification

- Golden **11/11**; `sla.spec` **7/7** (refactor behaviour-identical); admission + staff + sla jest
  **118/118**; clean `nest build`; app boots, DI resolves (SubmissionModule ← FollowUpModule), cron
  registered. Frontend `tsc` clean + `next build` OK.
- Integration smoke vs the real DB **11/11**: `followUpDue` flag (overdue vs today); sweep creates
  one task for the overdue PENDING attempt, **assigned to the case consultant**; not-yet-due gets
  none; idempotent; logging a response **resolves inline**; superseded attempt → sweep resolves the
  old + opens for the new; removing an attempt clears its task inline.

## Honest notes / follow-ups

- **No admission task-list page yet.** The `SUBMISSION_FOLLOW_UP` task is created + returned by the
  existing `/staff/admission-tasks` API, and the Case File shows the due badge — but a cross-case
  "my follow-ups" queue page (like the nurture one) doesn't exist for admission tasks. Worth building
  as its own slice if the Owner wants the queue view; the specialist's natural flow (log the response
  → task auto-clears) works without it today.
- **ACKNOWLEDGED clears the follow-up** — any non-PENDING outcome counts as "a response," so an
  acknowledged-but-not-yet-decided application won't keep nagging. A second-stage chase (e.g. N days
  after ACKNOWLEDGED) is a possible later refinement.
- **5 working days is a constant** (`FOLLOW_UP_WORKING_DAYS`), not per-country configurable — matches
  "the 5-day follow-up". A config knob is a clean later addition if needed.

## Where this sits in the Admission Specialist portal build

Step 1 → 2a → 2b → 3 → **Step 4 (Submission Log)** → **Step 5 (5-day follow-up) ✓** →
Step 6 (Offer/Decline/Sequential) → Step 7 (finality signal) → catch-ups.
