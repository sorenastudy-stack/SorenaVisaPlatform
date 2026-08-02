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
- **`CvGenerationAgent`** (`src/ai/agents/cv-generation.agent.ts`, in `AiModule`) — a proper AI
  agent keyed to `CV_GENERATION`, mirroring `LeadQualificationAgent`: it **owns the dedicated CV
  prompt** and the `ClaudeService` call, and returns the parsed `{summary, skills}` narrative
  (never throws — on AI failure returns empty + `available:false`). The prompt is **localized to
  the applicant's chosen programmes** (target field/university). Generation logic lives here, not
  in `CvService`.
- **`CvService`** — the thin CV-document **lifecycle orchestrator**: gather verified data (incl.
  the chosen programmes) → `cvAgent.generateNarrative(source)` → `assembleCv` → persist/version.
  **Gated to `SUBMITTED`/`LOCKED`** applications: generation is refused on a DRAFT (the CV must be
  tailored to the programmes the client actually chose — the shared finality point with Step 4).
  **AI-optional:** if the agent's AI is unavailable, the CV **still generates with real facts** +
  an empty narrative the specialist writes — never blocks on the AI.
- **Endpoints** (`/staff/cases/:caseId/cv`, curator roles): `GET` (current + version history),
  `POST /generate`, `PATCH /:cvId` (DRAFT only — APPROVED is locked), `POST /:cvId/approve`.
- **UI** — a real **AI-generated CV** section in the Case File Admissions tab: Generate → review
  (edit summary + skills; factual sections read-only, corrected upstream in Employment/Education
  then regenerate) → Approve (locks, shows the lock badge). Regenerate makes a new version.

## Timing + architecture (post-2b correction, applied)

Per the Owner correction: CV generation must run **only after the client submits their programme
choices** (so it's localized to the chosen field/university, not generic), and must live in a
**proper AI agent** using the `CV_GENERATION` type — not folded into the service. Both applied:
generation is a staff-triggered action **gated to `SUBMITTED`**, the narrative is produced by
`CvGenerationAgent` (owns its prompt; no `AIAgentConfig` wiring for now, matching
`LeadQualificationAgent`), and the source/prompt include the chosen `AdmissionProgrammeChoice →
programme/provider/field/level`. The **truthfulness guarantee carried over untouched** — the AI
still only writes `{summary, skills}`; facts remain deterministic from verified rows.

## Verification

- Golden **12/12** (incl. "target programmes never leak into the factual sections"); admission +
  staff jest **67/67**; clean `nest build`; frontend compiles; app boots, 4 CV routes mapped, DI
  resolves (CvService ← CvGenerationAgent ← AiModule).
- Restructure integration smoke vs the real DB **8/8**: generate refused on DRAFT (submit-gate),
  allowed once SUBMITTED, facts from the real employment row, narrative from the agent, the agent
  **received the chosen programme** (localization), the target university did **not** leak into
  the factual sections, and the AI-unavailable fallback (facts present, no throw).
- (Earlier full-lifecycle smoke — generate/edit/approve/lock/regenerate/versioning — 15/15 remains
  valid; the restructure changed the generation path, not the lifecycle.)

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
