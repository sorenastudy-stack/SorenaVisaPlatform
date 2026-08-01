# PR-CATALOG-2 (Piece 2) — Monthly automated web re-sync: change monitoring + new-programme discovery

**Status:** DESIGN ONLY — nothing built yet. This is the pre-build design of record,
approved before any code (same process as every phase). Supersedes the short "Piece 2"
stub at the bottom of `PHASE_CATALOG_1_PROGRAMME_APPROVAL.md`.

**Date:** 2026-08-01
**Scope decision (Owner):** build the *fuller* version from day one —
(a) change-monitoring on known programmes **and** new-programme discovery from each
institution's catalogue; (b) a headless browser (Playwright) present from v1, not a
later escalation. Every finding — change proposals **and** new-programme candidates —
goes through the **same per-programme Owner-approval queue** from Piece 1. **Nothing
auto-publishes, regardless of confidence.**

**Approved design decisions (this doc):**
1. Data model = **two tables** — keep `ProgrammeChangeProposal` as-is for field changes;
   add a sibling `ProgrammeCandidate` for new-programme discovery. (Not the polymorphic
   single-table variant.)
2. Noise control = **all guards** — first-run guard + confidence threshold + per-run cap
   with an explicit summary of what was capped.
3. Fetch = **axios-first, Playwright-escalation** (headless present, used selectively).

---

## 0. Honesty correction to Piece 1

Piece 1's handover said *"locking the shape now means Piece 2 needs no migration."* That
holds **only for the field-change half** — the model we actually built. New-programme
discovery, added to scope now, **does** need one additive migration (§4). No existing
table or column changes; no enum change (`AUTOMATED_WEB_CHECK` already exists). Clean and
additive via the isolated-migration workaround — but it *is* a migration, stated plainly.

## 1. Grounding facts (verified, not assumed)

- `EducationProgramme.programmeUrl String?` already exists — schema.prisma:2288, commented
  *"official programme page — RAG monitoring source #1"*; `verificationSourceUrl` is #2.
  **Monitoring already has its target URL.**
- `Provider` has `websiteUrl`/`aboutUrl` but **no programme-listing entry point** →
  discovery needs a new `catalogueUrl` field.
- `ProgrammeChangeProposal.programmeId` is a **required non-null FK**; `changedFields` is a
  **diff** (`{from,to}`). Structurally a change-to-existing record — no room for a whole
  new programme. → the crux of §4.
- Installed: `@nestjs/schedule` 6.1.3, `axios` 1.14, `@anthropic-ai/sdk` 0.82, `xlsx` 0.18.
  **Not** installed: puppeteer / playwright / cheerio.
- `ClaudeService` today = one `chat(system, user) → string`, `max_tokens: 1000`, freeform,
  no structured output, no retry. Too thin for extraction → additive extension (§3).

## 2. Architecture — two crawl units

Two passes, fundamentally different risk, so different crawl units.

**Pass A — Monitoring (known programmes).** Crawl unit = **one approved programme's
`programmeUrl`**. Fetch known page → extract tracked fields → diff vs DB → *field-change*
proposal (`ProgrammeChangeProposal`). Deterministic: known URL, known identity, known
fields to compare.

**Pass B — Discovery (new programmes).** Crawl unit = **one institution's programme-index
page** (new Owner-supplied `Provider.catalogueUrl`). Harvest candidate links from the index
→ drop any already in DB (dedupe) → fetch each unknown page → extract a *full* record →
*new-programme candidate* (`ProgrammeCandidate`).

Bounded to **2 levels, never a recursive site spider**:

```
Provider (ACTIVE)
├─ catalogueUrl ──► index page(s), paginated ≤N ──► candidate links ──► (unknown only) ──► extract   = Pass B
└─ each approved programme ──► programmeUrl ──► extract ──► diff                                        = Pass A
```

**Biggest reliability lever: `catalogueUrl` is Owner-configured, not guessed.** Auto-finding
a programme index from a homepage is where the crawl goes unbounded/unreliable. Pointing at
*one listing page we were handed* makes it bounded and testable. No `catalogueUrl` →
discovery skips that institution; monitoring still runs.

### Components (NestJS) — I/O isolated at the edges, logic stays freeze-testable

| Component | Responsibility | Testability |
|---|---|---|
| `CatalogSyncCronService` | thin monthly `@Cron`, never throws — mirrors `NurtureCronService` | trivial |
| `CatalogSyncService` | orchestrator, **injected clock**; runs both passes per active institution | pure logic + faked deps |
| `PageFetchService` | **axios-first, Playwright-escalation** → clean text + final URL + renderMode | only place Playwright lives, behind one interface |
| `ProgrammeExtractionService` | extended-Claude call → validate/normalise via **existing `programme-import.logic.ts` parsers** | pure normalisation golden-tested |
| `ProposalService` | write/read/apply proposals (both kinds) | pure apply logic golden-tested |

**Two choices to highlight:**
- **Headless is selective.** Present from v1 (per the Owner call), but `PageFetchService`
  tries axios first and escalates a *single URL* to Playwright only when the page looks
  JS-empty (little text / no expected links / SPA shell). Most static NZ institution pages
  never launch Chromium — covers JS-rendered sites without paying browser cost on every one
  of hundreds of pages.
- **Extraction reuses the Excel importer's parsers.** `nzqf`, `durationMonths`, `ieltsMin`,
  `studyFieldKey`… from `programme-import.logic.ts` normalise AI-extracted fields into the
  *same* shape as an Excel row. On approval a candidate materialises through the same
  `rowToProgrammeData` → upsert path — **one code path** for creating programmes, same
  principle as Piece 1's CLI/endpoint unification.

**Freeze-then-change targets:** the field-diff (monitoring), the "is this actually new"
dedupe (discovery), and apply-on-approval. All pure, injected-clock, golden-batteried
before wiring; network/browser/AI behind interfaces so smokes run with fakes (no live
network in the smoke).

## 3. Reliability — honest, with noise-reduction built in (ALL GUARDS approved)

**Pass A (monitoring): moderate risk, bounded blast radius.** Page 404 → flag, don't
propose; redesign misreads a field; AI hallucinates a change. Each bad extraction = at
most one proposal per programme, shown `was X → now Y` — trivial to reject.

**Pass B (discovery): genuinely higher risk — not soft-pedalled.** Failure modes:
1. **False "new"** — marketing landing page, duplicate under another URL, non-degree short
   course, or a real programme we already have under a reworded title (dedupe miss).
2. **Wrong details on a real new programme** — fee/level/duration mis-pulled from a PDF or
   awkward table. Harder to catch than a diff; Owner must cross-check the source.
3. **Volume** — a catalogue can list 200–600 programmes. A newly-added institution with an
   empty DB makes *everything* look new → hundreds of candidates in one sweep. A changed
   URL scheme can make the whole catalogue look new again.

**Noise reduction (part of the build — all four):**
- **Hard dedupe before proposing** — skip candidates whose URL already maps to a programme,
  and whose normalised (name + NZQF level + campus) already exists, **including PENDING and
  REJECTED rows**, so a rejected candidate doesn't resurrect every month.
- **Confidence score per candidate** — extractor self-reports confidence + which required
  fields it found. Below threshold / missing core fields (no level, no fee, no recognisable
  qualification) → held out of the main queue into a secondary "needs a closer look"
  bucket. Never auto-published regardless — confidence controls *reachability*, not publish.
- **Per-institution per-run cap** — surface top-N by confidence; remainder **explicitly
  summarised, never silently dropped** ("47 more candidates found, capped — raise the cap
  or import via Excel"). No-silent-caps rule from prior phases.
- **First-run guard** — discovery is the wrong tool to *populate* an empty institution;
  Excel import stays that path. Discovery gated to institutions with an existing baseline
  (or explicit per-institution opt-in), so it diffs against a populated DB and proposes
  *what's new since last look*, not the whole catalogue.

**Owner review burden, plainly:** monitoring = a trickle (a few change proposals/month).
Discovery, aimed at a populated institution *with* cap + confidence + first-run guard = a
small stream of genuine candidates. Without those guards it would bury the Owner — which is
why they're load-bearing, not optional.

## 4. Data model — TWO TABLES (approved)

- **`EducationProgramme.source` / `sourceRef`: unchanged.** ✅ Web-discovered programmes land
  `source = AUTOMATED_WEB_CHECK`, `sourceRef = source URL`.
- **`ProgrammeChangeProposal`: unchanged.** ✅ Fits monitoring exactly — that's what it was
  built for.
- **New sibling `ProgrammeCandidate`** for discovery — it can't reuse
  `ProgrammeChangeProposal` because `programmeId` is a required FK (a candidate has no
  existing programme) and `changedFields` is a diff (a candidate is a whole record).

```prisma
// Provider.catalogueUrl  String?   // programme-listing/index entry point for Pass B (Owner-supplied)
// Provider.candidates    ProgrammeCandidate[]   // back-relation

model ProgrammeCandidate {
  id             String               @id @default(cuid())
  providerId     String
  source         ProgrammeSource      // AUTOMATED_WEB_CHECK (reuse enum)
  sourceUrl      String               // the programme page it was extracted from
  proposedData   Json                 // full extracted record → rowToProgrammeData shape
  confidence     Float?               // extractor self-assessed 0..1
  detectedFields String[]             // which required fields were actually found on the page
  // dedupe natural key (also blocks rejected-candidate resurrection):
  nameNormalized String
  nzqfLevel      String?
  campusCity     String?
  status         ChangeProposalStatus @default(PENDING)   // reuse enum
  reviewedById   String?
  reviewedAt     DateTime?
  detectedAt     DateTime             @default(now())

  provider Provider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([status])
  @@index([providerId])
  @@index([providerId, nameNormalized, nzqfLevel, campusCity])   // dedupe lookup
  @@map("programme_candidates")
}
```

Why two tables over one polymorphic table: each table keeps clean, enforceable invariants
(a candidate belongs to a *provider* and FK-cascades; a change belongs to a *programme*).
The polymorphic variant needed a nullable FK + two mutually-exclusive JSON columns whose
validity depends on a `kind` discriminator — weaker, and against the codebase's type
discipline. "One queue" is a UI/endpoint concern, solved by UNION (below), not a schema one.

## 5. Endpoints & UI (extend Piece 1, one queue)

`/providers/*` prefix (the provider-catalog domain — same reasoning as Piece 1).

- **`GET /providers/programmes/pending`** — grows to **UNION** field-change proposals +
  new-programme candidates into one shaped list, each tagged with its kind, so the Owner
  reviews everything in one place.
- **`PATCH /providers/proposals/:id/approve|reject`** and
  **`PATCH /providers/candidates/:id/approve|reject`** (or a kind-dispatching pair) —
  - approve **field-change** → apply the diff to the live programme.
  - approve **candidate** → materialise a real `EducationProgramme` via the shared importer
    `rowToProgrammeData` → upsert path (Owner just approved it).
  - reject → keep the row REJECTED (feeds dedupe so it doesn't reappear).
- **`Provider.catalogueUrl`** — editable on the `/staff/universities` institution edit view.
- **Programme approvals page** — render both kinds: change proposals as `was X → now Y`;
  candidates with source URL, confidence, detected-fields, and a "view source" link;
  secondary "needs a closer look" (low-confidence) bucket; a capped-summary banner.

## 6. Scheduling & infra

- **Cadence:** `@Cron('0 3 1 * *', { timeZone: 'Pacific/Auckland' })` — 03:00 on the 1st,
  overnight. Thin wrapper, never throws. ScheduleModule already registered app-wide.
- **Headless discipline** (~100–300 MB RSS/browser):
  - **One shared browser per sweep**, reused across pages, `finally`-closed even on crash
    (no leaked Chromium). Never a browser-per-institution in parallel.
  - **Institutions sequential** (monthly/overnight — no rush); **page concurrency 2–3** per
    institution via a small pool.
  - **Politeness/anti-bot:** ≥1–2 s + jitter between same-domain fetches; real User-Agent;
    backoff on 429/503; hard page cap per institution (ties to the discovery cap).
  - **Timeouts:** axios ~15 s, browser nav ~30 s ceiling; per-institution + per-sweep
    wall-clock budgets. Timeout → skip unit, log, continue.
  - **CAPTCHA/bot-wall (honest):** some sites (Cloudflare challenge, bot detection) will
    block even the browser. **Detect + log** ("institution X blocked — N pages
    unreachable"), skip, surface in the run summary. We do **not** defeat CAPTCHAs. Manual
    Excel remains the fallback for blocked institutions.
  - **AI cost/latency/limits:** hundreds of pages = hundreds of Claude calls. Mitigate:
    extract **only post-dedupe** pages, per-run cap, light concurrency, **retry/backoff on
    429** (ClaudeService lacks this today). Extraction needs **larger `max_tokens` +
    structured (JSON/tool-use) output** — additive `ClaudeService` extension, existing
    `chat()` untouched.
  - **Failure isolation:** one institution's failure never aborts the sweep; one page's
    failure never aborts the institution. "Never throws" at every level.
- **Playwright over Puppeteer:** built-in auto-waiting (`networkidle`, locator waits) tackles
  flaky JS catalogue pages; first-class `innerText` gives clean AI text **without cheerio**;
  robust cross-site defaults; clean TS API for NestJS. Caveat: `npx playwright install
  chromium` adds a real binary footprint to the box and deploy image — accepted per the
  Owner's explicit call, but stated.

## 7. Build order (Piece 2 as its own phase; nothing auto-published)

1. Additive migration: `ProgrammeCandidate` + `Provider.catalogueUrl` + `Provider.candidates`
   relation (isolated-migration workaround).
2. `ProgrammeExtractionService` + `ClaudeService` extension (structured output, bigger
   tokens, 429 retry) — **freeze + golden battery** on the pure normalisation.
3. `PageFetchService` (axios→Playwright ladder) behind an interface.
4. `CatalogSyncService` orchestrator (injected clock) — **freeze + golden battery** on diff,
   dedupe, apply; integration smoke with a **fake fetcher/extractor** (no live network).
5. Monthly `@Cron` wrapper.
6. Extend the approvals queue endpoint/UI to render + act on both proposal kinds.

## 8. Honest overall stance (unchanged)

University sites vary wildly. Monitoring is reasonably reliable; **new-programme discovery
is inherently noisier** and is an *assistive* aid needing the guards above plus ongoing
Owner correction. **Manual Excel import stays the reliable default and the fallback for any
institution that's JS-locked, bot-walled, or has no configured `catalogueUrl`.** Automation
narrows the manual gap; it does not replace the human review gate.
