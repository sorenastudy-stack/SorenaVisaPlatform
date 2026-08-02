# PR-ADMISSION-SUBMIT — Step 4: per-institution Submission Log

**Status:** BUILT + VERIFIED (2026-08-03). Backend + Case File UI shipped together. Depends on the
submitted `AdmissionProgrammeChoice` rows and the Case File Admissions tab.

## Shape (an append-only event log, not a versioned document)

Unlike the CV/SOP (one versioned doc that supersedes), a submission is an **event**: the Admission
Specialist logs each attempt to submit the client's application to an institution. Owner decisions
(2026-08-03), all as recommended:

- **Append-only history of attempts.** `SubmissionRecord` is **one row per submission attempt**,
  keyed per `(case, admissionProgrammeChoice)`. A **resubmission is a new row**, never an overwrite —
  the full trail is preserved. The submission facts (`submittedAt`/`method`/`portalName`/
  `referenceNo`) **freeze at creation**; only the institution's **response** to that specific attempt
  (`outcome`/`responseReceivedAt`/`responseNotes`) is completed later. A choice's **current status =
  its latest attempt** (newest `submittedAt`, tiebroken by newest `createdAt`).
- **Coarse outcome here; offer detail in Step 6.** `SubmissionOutcome` = `PENDING` / `ACKNOWLEDGED`
  / `OFFER` / `DECLINED` / `WITHDRAWN`. The formal offer (conditions, expiry, letter file) is the
  Step-6 Offer record, linked later — no duplication.
- **Method = enum + free-text portal.** `SubmissionMethod` = `PORTAL` / `EMAIL` / `AGENT_PORTAL` /
  `OTHER` (filterable/reportable), plus a free-text `portalName` for the specific system.

## What shipped

- **`SubmissionRecord`** + **`SubmissionMethod`/`SubmissionOutcome`** enums (additive migration
  `20260803120000`, isolated workaround — purely additive, new enums + table, FKs to existing
  tables). `onDelete: Cascade` on the choice FK auto-cleans a choice's log if the choice is removed.
- **Pure `submission.logic`** (golden **14/14**): `validateSubmissionInput` (valid + non-future
  submission date; response date valid, non-future, not before submission; valid method/outcome) and
  `summariseChoiceSubmissions` (the append-only "latest attempt wins" derivation, non-mutating).
- **`SubmissionService`** — `list` (each choice + attempt history newest-first + derived
  `currentOutcome`), `create` (a new attempt), `recordResponse` (completes one attempt's response —
  submission facts stay frozen), `remove` (delete a mis-entry). **Gated to `SUBMITTED`/`LOCKED`** —
  the same finality signal Steps 2b/3 use. No AI.
- **Endpoints** (`/staff/cases/:caseId/submissions`, curator roles): `GET`, `POST`,
  `PATCH /:id/response`, `DELETE /:id`.
- **UI** — a **Submission log** section in the Case File Admissions tab: per-choice card with a
  current-outcome badge, a "Log submission" form (date/method/portal/ref), the attempt history
  (newest first) each with a per-attempt "Record response" form (outcome/date/notes) and a
  delete-mis-entry button. Colour-coded outcome badges. Submit-gate empty state otherwise.

## Verification

- Golden **14/14**; admission + staff jest **100/100**; clean `nest build`; app boots, 4 submission
  routes mapped, DI resolves. Frontend `tsc --noEmit` clean; `next build` succeeds.
- Integration smoke vs the real DB **13/13**: submit-gate refusal on DRAFT; create logs an attempt
  (defaults PENDING); future-date + invalid-method rejected; `recordResponse` sets the outcome and
  **leaves the submission facts frozen**; a resubmission appends and the current status follows the
  **latest** attempt; response-before-submission rejected; delete removes a mis-entry; cross-case
  record-id guards throw.

## Honest notes / follow-ups

- **Coarse-outcome boundary with Step 6:** `OFFER` here is a status flag; the Offer record (Step 6)
  will hold the conditions/expiry/letter and can key off the latest OFFER submission.
- **Delete is the one mutation of submission facts** — deliberately kept for correcting a
  mis-entered attempt; the append-only trail is otherwise never rewritten.
- **No document linkage yet:** a submission doesn't hard-reference the approved CV/SOP bundle sent;
  that linkage (which CV/SOP version accompanied a submission) is a possible later enrichment.

## Where this sits in the Admission Specialist portal build

Step 1 (Case File substance) → Step 2a (employment) → Step 2b (AI CV) → Step 3 (AI SOP + gates) →
**Step 4 (Submission Log) ✓** → Step 5 (5-day follow-up) → Step 6 (Offer/Decline/Sequential) →
Step 7 (finality signal) → catch-ups.
