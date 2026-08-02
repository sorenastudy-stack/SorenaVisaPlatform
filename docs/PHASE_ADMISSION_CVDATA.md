# PR-ADMISSION-CVDATA — Step 2a: real employment-history capture (admission stage)

**Status:** BUILT + VERIFIED (2026-08-03). Part of the Admission Specialist portal build
(Case File → **Step 2a here** → Step 2b AI CV → …).

## Why

The AI CV's **Experience** section must use **verified** data (employer, job title, dates),
not derived approximations from coded scorecard buckets (the scorecard only has "3–5 years in
IT"-style buckets). Rather than dress up an approximation as a factual claim in a document that
goes to universities — which would violate the project's "no unvalidated input in critical
documents" rule — we **collect the real thing from the client now**, at admission stage, in a
proper structured, editable table.

## Placement decision (recorded)

Employment history is captured in the **client Admission (Apply/Study) flow** — a new dedicated
step — **not** the scorecard (a coded lead-qualification instrument, wrong audience) and **not**
a staff-side CV step (staff surface, wrong place to prompt a client). This mirrors the codebase's
established **admission-primary / visa-supplements** architecture for education
(`AdmissionEducationEntry` → `VisaEducationSupplement`).

## What shipped (2a)

- **`AdmissionEmploymentEntry`** (additive migration `20260803060000_…`): `employerName`,
  `roleTitle`, `startYear`, `endYear`, `isCurrent`, `countryOfWork`, `organisationField`,
  `dutiesText`, `sortOrder`, off `AdmissionApplication`. **Field names mirror
  `VisaEmploymentEntry`** for frictionless reuse. Year-level (not exact dates) — the client can
  refine over time.
- **Client CRUD** (`admission.service` + controller, mirroring the education-entry pattern):
  `POST/PATCH/DELETE /students/me/admission/application/employment-entries`. DRAFT-only edits.
  Included in the application payload (`loadFullApplication`).
- **Pure `validateEmploymentYears`** (`employment-history.logic.ts`) — frozen, golden battery
  7/7 (range, start≤end, current-role-has-no-end-year, draft nulls allowed).
- **New admission step** — internal step id **9** placed after Education in the visible-steps
  array (`stepVisibility.ts`). Internal ids need not be contiguous: the displayed number is the
  array position, so this keeps the **DOB-skip age logic (steps 5 & 6) and the content-tied step
  i18n keys untouched**. `StageProgressBar` refactored from min/max ranges to explicit step→stage
  sets so id 9 maps into Stage 2. New UI strings are inline English (Persian i18n frozen).
  `StepEmployment.tsx` = the client editor (draft + saved cards, add/edit/delete).
- **Case File staff view/edit** — `staff-admission-employment` module
  (`GET/POST/PATCH/DELETE /api/staff/cases/:caseId/employment-entries`, curator roles, no DRAFT
  lock — mirrors `staff-admission-choices`). An **Employment history** section in the Case File
  Admissions tab: list + add + delete (the client is the primary field-editor).

## ⚠️ FAST-FOLLOW (NOT in this slice — do not forget)

**Wire the visa Step-7 employment to REUSE these admission rows**, exactly as
`VisaEducationSupplement` reuses `AdmissionEducationEntry` (PR-VISA6). Today `VisaEmploymentEntry`
is still captured fresh at the visa stage. The admission table is **designed** reuse-ready
(mirrored field names, admission-primary), but the actual pre-fill/supplement wiring is its own
slice so nothing is asked twice. Options when picked up: (a) a `VisaEmploymentSupplement` holding
only visa-only extras (employer address, encrypted duties, month precision) over the admission
row, or (b) pre-fill `VisaEmploymentEntry` from the admission rows on visa-flow entry. **Until
then, visa Step 7 still collects employment independently.**

## Verification

- Pure golden battery 7/7; admission + staff jest **55/55**; clean `nest build`; frontend
  production build compiles (`/student/admission` includes the new step).
- App boots, all employment routes mapped (client + staff), DI resolves.
- Integration smoke vs the real DB **5/5** — add / list / update / toggle-isCurrent / delete,
  and it **caught a real bug**: toggling `isCurrent:true` on a role that had an `endYear` was
  wrongly rejected (validation ran before the end-year was cleared). Fixed in **both** the client
  and staff update methods (clear the effective end-year before validating).

## Next: Step 2b — AI CV

Generate from real education + **real employment (these rows)** + verified questionnaire data;
Experience uses the structured employment, never coded buckets. `CvDocument` draft→approved→locked
versioning; Admission Specialist review/edit/approve; fake-Claude integration smoke.
