# PR-SCORECARD-1 — Readiness Assessment backend

The first PR in the Scorecard arc. Ports the existing Python scoring engine (`sorena_scoring.py` v2.0) into the NestJS backend verbatim, persists submissions through an encrypted-at-rest model, and wires the result into the existing CRM by auto-creating a Lead row. Ships with a minimal `/staff/scorecards` admin surface so we can see submissions land before PR-SCORECARD-2 introduces the public-facing form.

The engine is not invented — every SCORES key, every hard-stop predicate, every band threshold, every gate check is a direct port from the Python source recovered from `E:\documentation\sorena platform\19042026\score card\Sorena_Scoring_Reference\` and saved (git-ignored) at `Sorena_Scoring_Reference/` in the project root.

---

## 1. Scope

In:

* New backend module `backend/src/scorecard/` with a pure-TypeScript scoring engine, a service, a controller, DTOs, and unit tests
* New Prisma model `ScorecardSubmission` + 2 new enums (`ScorecardBand`, `ScorecardNextAction`)
* New `LEAD` value on the existing `UserRole` enum (between `SUPPORT` and `STUDENT`)
* Hand-written migration `20260527090000_pr_scorecard_1_engine` (no `migrate dev`)
* Lead auto-creation pipeline — every submission spawns a `Lead` row via the existing CRM, populated with the score breakdown the rest of the platform already understands (`readinessScore`, `academicScore`, `financialScore`, `englishScore`, `intentScore`, `scoreBand`, `riskFlags`, `hardStopFlag`)
* 4 new audit event types
* `/staff/scorecards` list + detail pages (minimal — full design lands in PR-SCORECARD-2)

Out (deferred):

* The public-facing form UI (`/scorecard/landing` + multi-step form) → **PR-SCORECARD-2**
* PDF report generation (port of `score_pdf.py` / `client_report.py`) → **PR-SCORECARD-3**
* Stripe integration for Band 3's 30 NZD Gap-Closing Session → **PR-SCORECARD-4**
* Wix Bookings URL configuration / per-language calendar routing → **PR-SCORECARD-5**
* Email automation for nurture sequences (Bands 1–2)
* AI-generated improvement plan for Band 3
* Persian UI translations for the form itself (the `nextActionTextFa` copy ships here)
* Multi-step form autosave persistence
* Bulk CSV export of scorecards
* Year-over-year band analytics

---

## 2. The scoring engine port — what was copied, what's new

Source: `Sorena_Scoring_Reference/sorena_scoring.py` (594 lines, recovered from the user's E: drive zip via the .lnk shortcut at `C:\Users\OEM\AppData\Roaming\Microsoft\Windows\Recent\Sorena_Scoring_Engine.zip.lnk`).

### Copied verbatim (no inference)

| File | What it ports | Source lines |
|---|---|---|
| `scoring/scores.ts` (337 LOC) | The full `SCORES` dict, `FIELD_CATEGORIES`, `CATEGORY_NAMES`, `CATEGORY_MAX` | sorena_scoring.py:18–359 |
| `scoring/hard-stops.ts` (88 LOC) | All 6 hard-stop predicates HS1–HS6 with code/name/reason/resolution strings unchanged | sorena_scoring.py:362–437 |
| `scoring/risk-flags.ts` (60 LOC) | 10 risk-flag detection rules with their exact label strings | sorena_scoring.py:444–467 |
| `scoring/bands.ts` (107 LOC) | The `BANDS` table + `band_for(total)` resolver | sorena_scoring.py:474–498 |
| `scoring/gates.ts` (31 LOC) | The 5-gate `check_execution_gates` function | sorena_scoring.py:505–521 |
| `scoring/engine.ts` (122 LOC) | The main `score(answers)` orchestrator including the legacy `next_action` string | sorena_scoring.py:528–594 |

Every key string (capitalisation, em-dashes, spacing, punctuation) is preserved because the SAMPLE_Scoring_Report.pdf renders them verbatim and the audit log echoes them.

### New (not in Python)

| File | Why |
|---|---|
| `scoring/routing.ts` (62 LOC) | Maps `band + hardStops` to the structured `ScorecardNextAction` enum + English / Persian copy that the API returns. The Python engine produces a single `next_action` string for the report PDF; the modern API consumes a typed enum and language-specific copy. The strict rule that **Band 6 still requires the free 15-min session** is enforced here. |

### Unit tests

`scoring/scoring.spec.ts` (218 LOC) — **40 tests, 40 pass**:

* **9 tests** for the Maryam Karimi sample case from `SAMPLE_Scoring_Report.pdf` page 3 — replays all 47 scored answers, asserts `total === 100`, `band === 'BAND_6'`, all categories cap correctly, zero hard stops, zero risk flags, all 5 gates pass, routing maps to `BOOK_FREE_15MIN_SESSION`
* **12 tests** for hard stops — every HS1..HS6 trigger condition (including the multi-branch HS1 and HS4 cases) plus a Maryam-set sanity check that confirms zero stops fire when none should
* **12 tests** for band-threshold boundaries — totals 0/24/25/39/40/54/55/69/70/84/85/100 all classify into the correct band
* **8 tests** for routing — each band → expected `ScorecardNextAction`, hard stop overrides band, all three Persian translations present

Run with `cd backend && npx jest src/scorecard/scoring/scoring.spec.ts`.

---

## 3. Data model

```
            UserRole.LEAD (new)
                  │
       ┌──────────▼──────────┐
       │      User          │
       │   role: LEAD/...   │
       └────────┬───────────┘
                │ 1:N
                ▼
    ┌─────────────────────────────────────┐
    │ ScorecardSubmission                 │
    │ - userId                           │
    │ - answersEncrypted (Bytes, AES-256-GCM)
    │ - totalScore, category1..4Score    │
    │ - band: ScorecardBand              │
    │ - hardStops (JSON), riskFlags[]    │
    │ - executionEligible, gateResults   │
    │ - nextAction: ScorecardNextAction  │
    │ - nextActionTextEn, ...Fa          │
    │ - leadId @unique → Lead            │
    │ - consultationBookedAt             │
    │ - ipAddress, userAgent (audit)     │
    └────────┬────────────────────────────┘
             │ 1:0..1
             ▼
       ┌───────────────────────────────┐
       │ Lead (existing CRM, extended) │
       │ - sourceChannel: "SCORECARD"  │
       │ - leadStatus: SCORING_DONE    │
       │ - readinessScore = total      │
       │ - academicScore = cat2        │
       │ - financialScore = cat3       │
       │ - englishScore = Q22 points   │
       │ - intentScore = Q27 points    │
       │ - scoreBand: legacy LOW/MID/HIGH mapped from BAND_1..6 │
       │ - riskFlags[], hardStopFlag, ...                       │
       └───────────────────────────────┘
```

### Why a separate ScorecardSubmission table

* **History.** Re-takes (after an IELTS upgrade, after closing a funding gap) need to be preserved. Storing the full result snapshot on `Lead` would lose that history.
* **PII isolation.** The encrypted answers column is the largest PII payload on any row in the codebase. Keeping it on its own table means we can apply column-level encryption controls without affecting the rest of the Lead surface.
* **Computed-column denormalisation.** Total, category sub-totals, band, gate results all live on the row so the staff view doesn't have to re-run the engine on every read. The engine is the source of truth at *submit* time; re-running it on a stored answers payload should reproduce the same numbers (and the staff detail view does exactly that to surface per-field points).

### `Lead` linkage as `1:0..1`

`ScorecardSubmission.leadId` is `@unique`. The unique constraint enforces "one Lead per submission" — re-submissions don't pile on the same Lead row; instead each submission gets its own Lead. The CRM may want to dedupe by Contact later, but at the row level the relationship stays clean.

### `UserRole.LEAD`

Sits between `SUPPORT` and `STUDENT` in the funnel: anonymous visitor → submits scorecard → `LEAD` → pays for account → `STUDENT`. The service deliberately only promotes a user to `LEAD` if their current role is `null` / `SALES` / `SUPPORT` (the default-ish roles). Anyone already at `STUDENT` / `OWNER` / `ADMIN` / `LIA` / etc. keeps their existing role even when they test-submit a scorecard.

---

## 4. Backend — files added / modified

### New (12)

* `backend/src/scorecard/scoring/scores.ts`        (337 LOC)
* `backend/src/scorecard/scoring/hard-stops.ts`    (88 LOC)
* `backend/src/scorecard/scoring/risk-flags.ts`    (60 LOC)
* `backend/src/scorecard/scoring/bands.ts`         (107 LOC)
* `backend/src/scorecard/scoring/gates.ts`         (31 LOC)
* `backend/src/scorecard/scoring/engine.ts`        (122 LOC)
* `backend/src/scorecard/scoring/routing.ts`       (62 LOC)
* `backend/src/scorecard/scoring/scoring.spec.ts`  (218 LOC — 40 tests)
* `backend/src/scorecard/scorecard.service.ts`     (~460 LOC)
* `backend/src/scorecard/scorecard.controller.ts`
* `backend/src/scorecard/scorecard.module.ts`
* `backend/src/scorecard/dto/scorecard.dto.ts`
* `backend/prisma/migrations/20260527090000_pr_scorecard_1_engine/migration.sql`

### Modified (3)

* `backend/prisma/schema.prisma` — `UserRole.LEAD`, two new enums, `ScorecardSubmission` model, inverse relations on `User` + `Lead`
* `backend/src/app.module.ts` — register `ScorecardModule`
* `backend/src/common/audit/audit.helper.ts` — 4 new event types

### Modified (gitignore)

* `.gitignore` — adds `Sorena_Scoring_Reference/` so the source materials are never committed

---

## 5. Frontend — files added

* `frontend/src/app/staff/scorecards/page.tsx` — list view with band + eligibility chip filters
* `frontend/src/app/staff/scorecards/[id]/page.tsx` — detail view with category breakdown, hard stops, risk flags, 5-gate check, next-action card (EN + FA), linked-lead card, full answer log grouped by category

The existing `/staff/layout.tsx` (PR-CONSULT-2) already permits all 7 staff roles, so the backend role gate (`OWNER`/`ADMIN`/`SUPER_ADMIN`/`CONSULTANT` only) is the effective filter.

No public form, no sidebar nav addition — both deferred to PR-SCORECARD-2.

---

## 6. Routes

| Verb | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/scorecard/submit` | `LEAD, STUDENT, OWNER, ADMIN, SUPER_ADMIN` | Submit answers, get scored result back |
| GET  | `/scorecard/me/latest` | same | Own latest submission |
| GET  | `/scorecard/me/history` | same | All own submissions, newest first |
| GET  | `/staff/scorecards` | `OWNER, ADMIN, SUPER_ADMIN, CONSULTANT` | List view (latest 200) |
| GET  | `/staff/scorecard/:submissionId` | same staff set | Detail view; writes `SCORECARD_VIEWED_BY_STAFF` |
| POST | `/scorecard/:submissionId/booking-opened` | `LEAD, STUDENT` (own submission) | Best-effort tracking when user clicks the Wix link |

All controllers use `req.user?.userId ?? req.user?.id` (d95640d).

---

## 7. Audit events (new)

* `SCORECARD_SUBMITTED` — `{ submissionId, band, totalScore, executionEligible, hardStopCount }`
* `SCORECARD_LEAD_CREATED` — `{ leadId, scorecardSubmissionId }`
* `SCORECARD_VIEWED_BY_STAFF` — `{ submissionId, viewerUserId }`
* `SCORECARD_BOOKING_LINK_OPENED` — `{ submissionId }`

All 4 are surfaced in `summarizeAuditEntry` so the staff Activity feed renders them with one-line descriptions.

---

## 8. Routing rules (English + Persian copy in `routing.ts`)

| Band | Next action | Frontend triggers |
|---|---|---|
| Any band + any active hard stop | `BLOCKED_HARD_STOP` (overrides band) | none — staff handle directly |
| Band 1 / Band 2 | `NURTURE_ONLY` | `shouldShowNurtureMessage: true` |
| Band 3 | `PAY_GAP_CLOSING_SESSION` | `shouldShowPaymentLink: true` (Stripe wiring → PR-SCORECARD-4) |
| Band 4 / Band 5 / Band 6 | `BOOK_FREE_15MIN_SESSION` (mandatory even at 100) | `shouldShowBookingLink: true` + `shouldShowMalaysiaCallout: true` |

The Persian copy ships in `nextActionTextFa` on every API response. PR-SCORECARD-2 wires it to the public form's localised view.

---

## 9. Constraints honoured

* **No new npm dependencies.** Engine is pure TypeScript; tests use the existing Jest + ts-jest setup.
* **No new env vars.**
* **`answersEncrypted` is AES-256-GCM via `CryptoService`** — same envelope as every other Bytes column in the codebase. Decryption happens server-side at staff-view time (the per-case access check has already cleared the viewer).
* **No User role downgrade.** The `shouldPromoteToLead` helper only promotes from `null` / `SALES` / `SUPPORT`. Anyone at `STUDENT` / `OWNER` / `ADMIN` / `LIA` keeps their existing role.
* **No Stripe, no Wix API, no email-send code in this PR.** All deferred to follow-up PRs.
* **`req.user?.userId ?? req.user?.id` everywhere** — d95640d preserved.
* **Migration is hand-written**, never `prisma migrate dev`.
* **`Sorena_Scoring_Reference/` is gitignored** — only the TypeScript port goes into git.

---

## 10. Backlog

* **PR-SCORECARD-2 — Public-facing form UI.** Multi-step Next.js form at `/scorecard/landing` + `/scorecard/form` that posts to `POST /scorecard/submit`. Localised English / Persian copy, autosave-as-you-go via IndexedDB, results page reproducing the SAMPLE PDF layout in HTML, Wix booking embed for Bands 4–6.
* **PR-SCORECARD-3 — PDF report generation.** TypeScript port of `score_pdf.py` (internal report) + `client_report.py` (client-friendly version). Likely needs `pdfkit` or `puppeteer` — TBD when we pick the rendering approach.
* **PR-SCORECARD-4 — Stripe + Band 3 payment wiring.** A 30 NZD Gap-Closing Session checkout. Webhook updates `ScorecardSubmission.consultationBookedAt` (or a new payment-status column). PR-SCORECARD-2's result page renders the Stripe checkout link only for Band 3 + only after the user opts in.
* **PR-SCORECARD-5 — Wix Bookings configuration.** Per-language Wix calendar URL routing — Persian speakers see the language-matched Admission Specialist's calendar. New `PlatformSetting` rows keyed by `(language, band)` → calendar URL. The `booking-opened` endpoint already exists; PR-SCORECARD-5 wires the click to the real Wix URL.
* **Email automation for Bands 1–2 nurture.** Mailchimp / SendGrid integration. Probably driven by a cron that scans `ScorecardSubmission` for new Band 1 / Band 2 rows and adds the Lead's email to a nurture sequence.
* **AI-generated improvement plan for Band 3.** Anthropic Claude call that takes the answers + the gap-closing context and produces a personalised improvement plan PDF emailed to the lead post-payment.
* **Language-matched specialist routing for booking.** Once PR-SCORECARD-5 ships per-language URLs, extend to per-specialist routing based on Lead.preferredLanguage.
* **Bulk CSV export.** OWNER-only `/staff/scorecards/export.csv` that emits the latest N submissions for analytics in Excel / Google Sheets.
* **Year-over-year band analytics.** Pie / line charts on band distribution over time. Likely shares the Recharts setup from PR-LIA-11.
* **Re-take throttling.** Right now a user can re-take the assessment without limit. May need throttling later (one re-take per 30 days) if abuse appears.
* **Lead-dedup heuristic.** Currently each submission spawns a new Lead. If a Contact already has an open Lead, future logic could attach the submission to that Lead instead of creating a duplicate. Out of scope here.
* **Per-question category-2 cap edge cases.** The Python engine caps Cat 2 at 35 — Maryam's raw Cat 2 is 51 (loses 16 points to the cap). This is *correct* per the spec ("a strong applicant doesn't get extra credit beyond the maximum") but staff may want to see "raw vs capped" side-by-side in PR-SCORECARD-2's detail view. The data is already on the row (`catScoresRaw` is computed by the engine).
