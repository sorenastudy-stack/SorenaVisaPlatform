# PR-ADMISSION-SOP — Step 3: AI-generated SOP (generate / review / edit / evaluate / approve / lock)

**Status:** BUILT + VERIFIED (2026-08-03). Depends on Step 2 (the AI-agent + truthfulness pattern),
the submitted `AdmissionProgrammeChoice` rows, and the Case File Admissions tab.

## Shape (mirrors the Step-2 CV agent architecture, extended for gates)

One **Statement of Purpose per submitted programme choice** — each localized to the specific
institution/programme/intake the client chose, so the reasoning is genuinely institution-specific.
Generation + gate scoring live in a proper AI agent; the service is a thin lifecycle orchestrator.

- **`SopGenerationAgent`** (`src/ai/agents/sop-generation.agent.ts`, in `AiModule`, keyed
  `SOP_GENERATION`) — owns **two** dedicated prompts and both Claude calls, never throws:
  - `generateNarrative` authors ONLY the labeled narrative sections, localized to the chosen
    programme. AI failure → empty sections + `available:false`.
  - `evaluateGates` — a **separate, adversarial** pass (skeptical-INZ-officer rubric, kept distinct
    from drafting so the model doesn't grade itself soft) scoring the current narrative against the
    three gates. AI failure → **fail-closed** (every gate fails) + `available:false`.
- **`SopService`** — thin lifecycle orchestrator: gather verified data per choice → agent →
  `assembleSop` → resolve the per-country enforcement flag → persist a versioned `SopDocument`.
  **Gated to `SUBMITTED`/`LOCKED`** applications (shared finality point with Step 4), like the CV.
- **`SopDocument` / `SopStatus`** (additive migration `20260803000000`) — one per
  `(case, admissionProgrammeChoice)`, versioned exactly like `CvDocument`
  (supersede-DRAFT-on-regenerate; approve LOCKS that version; a later regenerate mints v+1;
  approved versions stay in history). `gateResultsJson` holds the last gate evaluation.
- **Endpoints** (`/staff/cases/:caseId/sop`, curator roles): `GET` (each choice + its current SOP),
  `POST /generate-all`, `POST /choices/:choiceId/generate`, `POST /:sopId/evaluate` (preview gate
  status), `PATCH /:sopId` (DRAFT only), `POST /:sopId/approve`.
- **UI** — a real **AI-generated SOP(s)** section in the Case File Admissions tab (mirrors the CV
  section): a per-choice card list, each showing the deterministic factual frame (read-only) + the
  three gates' pass/fail + reason (`GatePanel`, enforced-vs-advisory framing + a block banner) +
  the editable narrative sections while DRAFT. Generate (per choice or "Generate all"), Regenerate,
  Save (re-checks gates), Approve (locks). A failed approve surfaces the hard-block message and
  reloads the fresh verdicts into the panel.

## The truthfulness guarantee (adapted to a prose document)

An SOP is prose, so unlike the CV it can't be assembled entirely from rows — but the **factual
frame** (applicant name + the target institution/programme/intake + a verified profile line:
highest qualification, current role, English test) **is assembled deterministically from verified
rows** (`AdmissionEducationEntry`, `AdmissionEmploymentEntry`, `AdmissionApplication`, the chosen
`AdmissionProgrammeChoice`). `assembleSop` recomputes the frame from source and drops the AI
narrative onto it — so **the target institution SHAPES the narrative body but is structurally unable
to alter or fabricate a factual claim**. Proven in the golden battery ("even a malicious AI payload
cannot inject or overwrite a factual claim in the frame") and the integration smoke.

## The three quality gates (Owner decisions, 2026-08-03)

Career-plan specificity · New Zealand–specific reasoning · Home-country ties. Three decisions,
all locked as recommended:

1. **AI-scored, adversarial.** A separate skeptical-INZ-officer evaluation returns `pass`/`reason`
   per gate. `pass` counts only when it's an explicit boolean `true`; anything else (missing,
   stringy, garbled, AI outage) **fails closed** — an unparseable evaluation can never wave an SOP
   through. The human specialist remains the final approver.
2. **Hard-block on fail.** When enforced, a failing gate makes `approve()` throw with the failing
   gates' reasons (mirrors the CV's status-gate throw). The specialist edits/regenerates until all
   three pass. Gates are **re-evaluated against the current (possibly hand-edited) content** at
   approve time — never a stored verdict — and also on every `update`, so the UI never shows a
   verdict stale vs. the text.
3. **Honor the per-country `sopGateEnforcement` flag.** Resolved from the case's country
   `CountryAIConfig` (keyed by the applicant's country of residence, falling back to nationality),
   **defaulting to enforced=true** (the schema default) when no config row exists — a missing config
   never silently disables the gates. Flag OFF → gates are evaluated + surfaced (advisory) but never
   block. The pure `evaluateGateEnforcement(results, enforced)` decides `blocksApproval`.

## Verification

- Golden **19/19** (pure `sop-content.logic`): factual-frame determinism, tolerant narrative parse,
  the truthfulness no-leak test, fail-closed gate parsing (missing/garbage/non-boolean), and every
  enforcement quadrant. Admission + staff jest **86/86**. Clean `nest build`; app boots, 6 SOP
  routes mapped, DI resolves (SopService ← SopGenerationAgent ← AiModule).
- Integration smoke vs the real DB (fake Claude) **17/17**: submit-gate refusal on DRAFT;
  localization (chosen programme reaches the prompt); facts from real rows; enforced + failing gate
  → approve hard-blocked; edit-to-passing → approve locks; **flag OFF → advisory, approve allowed
  despite a failing gate**; AI outage → SOP still assembles from facts + gates fail-closed +
  block; regenerate mints v2, approved v1 stays APPROVED.

## Honest notes / follow-ups

- **Gate re-evaluation cost:** `update` and `approve` each run one gate-eval Claude call, so the
  stored verdict never goes stale vs. the text. These are deliberate staff actions, not
  high-frequency — acceptable. A debounce/cache is a later optimisation if needed.
- **AIAgentConfig not gated:** as with the CV, the per-agent prompt override isn't wired; the agent
  owns its prompt. The country-level `sopGateEnforcement` flag IS honored (that's the SOP-specific
  knob the Owner already designed).
- **SOP export (PDF):** `contentJson` (frame + labeled sections) is render-ready, but a PDF renderer
  is not part of this slice.

## Where this sits in the Admission Specialist portal build

Step 1 (Case File substance) → Step 2a (employment capture) → Step 2b (AI CV) → **Step 3 (AI SOP +
quality gates) ✓** → Step 4 (Submission Log) → Step 5 (5-day follow-up) → Step 6
(Offer/Decline/Sequential) → Step 7 (finality signal) → catch-ups.
