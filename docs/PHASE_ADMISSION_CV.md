# PR-ADMISSION-CV — Step 2b: AI-generated CV (generate / review / edit / approve / lock)

**Status:** BUILT + VERIFIED (2026-08-03). Depends on Step 2a (real employment history) and the
Case File Admissions tab (Step 1).

## The truthfulness guarantee (the core design)

The CV goes to universities, so it must never contain a fabricated fact. Instead of asking the
AI to write the whole CV (which could invent an employer or a date), the **factual sections —
header, education, experience, English — are assembled deterministically from verified DB rows**
(`AdmissionEducationEntry`, `AdmissionEmploymentEntry`, `Contact`, `AdmissionApplication`). **The
AI only authors the narrative `{ summary, skills }`.** So the AI structurally *cannot* alter a
factual section — proven in the golden battery ("even a malicious AI-parts payload cannot alter
the factual sections") and the integration smoke.

This extends the project's "no unvalidated input in critical documents" rule: the Experience
section is built from the **real employment rows** captured in Step 2a — never coded scorecard
buckets.

## What shipped

- **`CvDocument`** (additive migration) + **`CvStatus` (DRAFT/APPROVED/SUPERSEDED)**, versioned
  per case. Lifecycle mirrors `RecommendationList` (supersede-on-regenerate) + `AdmissionApplication`
  (status-guard lock): regenerate supersedes the prior DRAFT and mints v+1; **approve locks** that
  version; a later regenerate makes v+1 (approved versions stay in history, never superseded).
  `contentJson` = editable CV; `sourceSnapshotJson` = what fed generation (audit).
- **Pure `cv-content.logic`** (frozen, golden **12/12**): `buildFactualSections` (deterministic),
  `parseAiCvParts` (tolerant, never throws), `assembleCv`, `buildCvPrompt`.
- **`CvService`** — gathers verified data → `buildCvPrompt` → `ClaudeService.extractJson`
  (reused for the narrative) → `parseAiCvParts` → `assembleCv` → stores a new DRAFT. **AI-optional:**
  if the AI is unavailable (no key/error), the CV **still generates with real facts** + an empty
  narrative the specialist writes themselves — generation never blocks on the AI.
- **Endpoints** (`/staff/cases/:caseId/cv`, curator roles): `GET` (current + version history),
  `POST /generate`, `PATCH /:cvId` (DRAFT only — APPROVED is locked), `POST /:cvId/approve`.
- **UI** — a real **AI-generated CV** section in the Case File Admissions tab: Generate → review
  (edit summary + skills; factual sections read-only, corrected upstream in Employment/Education
  then regenerate) → Approve (locks, shows the lock badge). Regenerate makes a new version.

## Verification

- Golden **12/12**; admission + staff + scorecard jest **114/114**; clean `nest build`; frontend
  compiles; app boots, all 4 CV routes mapped, DI resolves.
- Fake-Claude integration smoke vs the real DB **15/15**: generate (real facts + AI narrative),
  edit a draft, approve+lock, editing/re-approving a locked version refused, regenerate → v2 DRAFT
  with v1 staying APPROVED in history, and the **AI-unavailable fallback** (empty narrative, facts
  still present, no throw).

## Honest notes / follow-ups

- **AI config not gated:** `AIAgentConfig.CV_GENERATION` (per-country enable/prompt) is still
  write-only in the codebase; CV generation runs standalone. Wiring the enable/prompt gate is a
  clean later addition (unchanged from the Step-2 state-check).
- **Narrative source:** the AI narrative is grounded in education + employment + admission
  questionnaire fields. The raw scorecard answers (encrypted) are **not** decoded into the prompt —
  the admission data already carries the CV-relevant facts; adding scorecard enrichment is optional
  later.
- **CV export (PDF):** `contentJson` is structured and PDF-ready, but a CV PDF renderer is not part
  of this slice.
- **Staff edit scope:** summary + skills are editable in the UI; factual sections are corrected in
  the Employment/Education data (single source of truth) and picked up on regenerate.

## Where this sits in the Admission Specialist portal build

Step 1 (Case File substance) → **Step 2a (employment capture)** → **Step 2b (AI CV) ✓** →
Step 3 (AI SOP + quality gates) → Step 4 (Submission Log) → Step 5 (5-day follow-up) →
Step 6 (Offer/Decline/Sequential) → Step 7 (finality signal) → catch-ups.
