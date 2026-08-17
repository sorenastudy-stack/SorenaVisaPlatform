# Standing backlog

Open items carried between sessions. Not a roadmap — just the things that were
deliberately deferred, with enough context to pick each one up cold.

Last updated: 14 August 2026.

---

## Small / quick

### Audit untracked `scripts/` files for stale references
**DONE — 14 Aug 2026.** Full sweep of all 54 files in `backend/scripts/`.

Five were rotted, all the same root cause: **service-constructor arity drift** (services
gained dependencies, the scripts still built them with the old argument count), so none had
run since those services changed. Four were fixed by supplying the missing arguments;
`e2e-onboarding-smoke.ts` was deleted with the Owner's per-file confirmation — broken *and*
asserting `liaPrice === 150`, a price disproved the day before.

`test-slot-engine.ts` (tracked) also seeded a literal `amountNZD: 150` — the pre-Phase-E NZD
price. Now derived from `getSessionConfig('LIA').price`, so it cannot drift again. Note for
whoever touches it: that column holds the **pre-GST base**, so a GST-inclusive figure would
be taxed twice (58.00 -> 66.70 correct; 66.70 -> 76.71 wrong).

The remaining 49 were checked beyond typecheck — DocuSign is still live (24 src files), the
`SALES` role is still a valid enum kept for legacy rows, and every HTTP path referenced still
exists — and found healthy. **The whole backend now typechecks clean including `scripts/`,
which it did not before.**

⚠ **Caveat for the next sweep:** 26 of these scripts use `as any`, often casting entire
services. A clean typecheck does **not** prove a script is healthy — `test-slot-engine.ts`
compiled perfectly while seeding a price that no longer existed. None were executed: several
are unsafe to run blind (`send-real-onboarding.ts` fires a real email,
`catalogue-import-prod.ts` runs against production, `purge-test-fixtures-local.ts` deletes
rows).

### Stale `.gitignore` line
**DONE — 14 Aug 2026.** Removed alongside the sweep, as its own note suggested.

### Delete `SESSION_CARD_FEE_PERCENT` from Railway
**Done / not needed** — it was never set in any service or environment. Kept here only so
nobody re-checks.

### `FINANCE_TABS` console noise — DONE 17 Aug 2026
`StaffBottomTabs.tsx` ran `t()` over the FINANCE tab labels, which are plain English, so
every FINANCE user got four `MISSING_MESSAGE` errors per page load. Now mirrors the
sidebar's `label.includes('.') ? t(label) : label`, and the comment that claimed the labels
were "rendered directly" is true again.

Verified in a real browser at mobile width, since the bar is `lg:hidden`: **4 errors before,
0 after**, with all four labels still rendering — a fix that merely hid the tabs would have
silenced the noise too.

---

## Money & billing

### Group 2/3 fee-string cleanup — derive ALL fee copy from `fee-config`
**DONE — 14 Aug 2026 (`c7d337d`).** Seven live wrong prices corrected, including a
"Pay NZD 30" CTA for a USD 23.00 session. The structural cure:
`backend/scripts/generate-fee-constants.ts` emits `frontend/src/lib/fees.generated.ts`, with
`npm run gen:fees:check` failing the build if the two diverge (proven by breaking it). Every
quantity is named explicitly — `base` / `total` / `inclGst` / `plusGst` / `cardTotal` —
because `routing.ts` proved that reading from the right *place* is not enough if you render
the wrong *quantity*. i18n now carries `{price}` placeholders. `bands.ts.revenue` deleted.

### AR redesign — link `Payment` to `Invoice` properly
`Payment` has no `invoiceId` column; the link is a soft `metadata.invoiceId`. All three
payment paths now write a Payment row (`b2ef3dc` closed the last one), so this is no
longer urgent — but the residual gap stands: **an invoice marked PAID by any other or
future route still shows nothing on the client's Payments page**, because history is
built from payments rather than merged with paid invoices. The schema comment anticipates
this redesign.

---

## Client portal

See `AUDIT_CLIENT_PORTAL_2026-08-13.md` for the full inventory and status table.

- **Finding #3 — payment gate fails closed. FIXED 14 Aug 2026.** An errored access check now
  means *unknown*, not *unpaid*, with the last definitive answer kept as a fallback.
  Verified by recreating the rate-limit condition, 11/11.
- **Shared rate-limit bucket — FIXED 17 Aug 2026.** Rate-limit buckets are now keyed by the
  *verified* session subject, falling back to IP for anonymous callers
  (`common/throttler/identity-throttler.guard.ts`). Server-rendered calls genuinely originate
  from the Next.js container, so there was no client address being dropped and nothing for
  `trust proxy` to recover — but `apiServer` already forwards the caller's session, so the
  request carries an identity even while it carries a borrowed address.

  Forwarding a client IP header instead was considered and rejected: on an auth-adjacent path
  it would mean trusting a client-settable header, letting anyone mint unlimited fresh buckets
  by varying it. Nothing was loosened — the token is verified rather than decoded, so a forged
  `sub` falls back to the IP bucket; anonymous pre-auth routes keep exactly their previous
  limits and keying; and a flood spread across many addresses by one account is now *more*
  tightly held than before.

  Verified end-to-end against both guards. Old: client B got 10/10 × 429 purely because client
  A had spent the shared bucket. New: A is limited after its own 60 while B is untouched, a
  forged token cannot escape the limit, and anonymous callers still share the address bucket.
  11 unit tests on the key derivation.
- **Findings 5–14, unambiguous set — DONE 14 Aug 2026.** Raw `tickets.department.null`
  badge, the assistant's raw markdown (in two components), the two untranslated shell
  strings, and the dashboard's false "is being processed" claim. Verified in a real browser
  in both locales, asserting absence as well as presence.
- **Finding: the dashboard's ticket count "contradiction" does NOT reproduce.** The two
  surfaces agree; see the ticket-model entry below for what is actually going on.
- **The four judgment calls — DONE 14 Aug 2026.** Settled by a standing rule from the Owner:
  **when a portal section has no data, show an empty state with a clear next action — never a
  silent redirect, never a hidden nav item.** Applied to all four: `/portal/report` now
  explains and offers the assessment instead of redirecting; the assistant is handed
  translated stage wording instead of raw enums; Meetings is in the sidebar; the wallet card
  shows its balance.
- **`/student/meetings` information architecture — DECIDED 17 Aug 2026.** It stays a
  standalone page rather than being folded into Booking. Owner decision; no code change, and
  nothing was pending — the sidebar entry added under the empty-state rule is the final
  shape. Recorded here so it is not re-opened as an unanswered question.

### Two ticket models — CLOSED 15 Aug 2026

`VisaSupportTicket` is the only ticket model in use. The cause was a **route collision**:
`StudentsController` and `TicketsController` registered the same four paths, Express served the
older one, and the controller written against the canonical model never received traffic.
Fixing it also fixed the close-ticket 404, the `tickets.department.null` badge and the empty
"Reply:" label. No migration was needed — production and demo both held **zero** legacy rows.

The last open sub-item is resolved: the kanban "raise a ticket" action has been **removed**
rather than ported. It wrote a model no staff surface reads, so raised tickets reached nobody;
raising a ticket against a pre-contract lead is not a supported workflow (Owner decision).
Nothing in the backend now reads or writes `Ticket` / `TicketMessage`; both tables keep their
rows, unreferenced.

Full detail, verification and rollback: `PHASE_TICKET_MODEL_CONSOLIDATION.md`.

### Persian / RTL — 21-item inventory, SCOPED 17 Aug 2026

A full read-only inventory replaced the old six-item note (which was stale — it still listed
the wallet and payment gate, both already translated). **Owner decision, 17 Aug 2026: translate
items 7 and 14 only. Everything else stays English — do not re-investigate or re-flag.**

The translation catalogue itself is near-complete. The
gap is hardcoded English, which needs a developer to extract each string *before* it can be
translated. (Counts below are as at 17 Aug 2026: **2,011 English keys, 2,006 Persian** — the
five absent are staff role labels.) Two structural categories:
**(A) wired** = the slot exists, someone types Persian; **(B) hardcoded** = code change first.

| # | Screen / area | Strings | Cat. | Status |
|---|---|---|---|---|
| 1 | Assessment / scorecard questionnaire (`app/scorecard`, `lib/scorecard/questions.ts`) | ~275 + 29 | B | **deferred — remains English** |
| 2 | Assessment result + advice text (`ScorecardResultClient`, backend `routing.ts`) | 28 wired / advice from backend | mixed | **deferred — remains English** |
| 3 | Wallet | 0 | — | already translated, nothing to do |
| 4 | Payment-gate panel | 0 | — | already translated, nothing to do |
| 5 | 14-step visa form (`components/student/visa/steps/`) | 47 | A | **deferred — remains English** |
| 6 | 9-step admission form (`StepEmployment` + 8 declaration keys) | 21 + 8 | mixed | **deferred — remains English** |
| 7 | **Client portal home / case page** (`app/portal/case/page.tsx`) | 13 | B | **DONE 17 Aug 2026** — `PHASE_PERSIAN_CASE_PAGE_AND_CLIENT_REPORT.md` |
| 8 | Explore programmes + programme detail | 34 | B | **deferred — remains English** |
| 9 | Programme recommendations | 14 | B | **deferred — remains English** |
| 10 | Sign-in / password / email-verification (12 pages) | 98 | B | **deferred — remains English** |
| 11 | Portal chrome + error states | ~14 | B | **deferred — remains English** |
| 12 | Student meetings / tickets / chat leftovers | ~10 | mixed | **deferred — remains English** |
| 13 | All outbound emails (26 types) | ~93 body + 21 subjects | B | **deferred — remains English** |
| 14 | **Client readiness report PDF** (`scorecard/pdf/client-report.ts`) | 48 | B | **DONE 17 Aug 2026** — Vazirmatn; `PHASE_PERSIAN_CASE_PAGE_AND_CLIENT_REPORT.md` |
| 15 | Tax invoice PDF | 5 | B | **deferred — remains English** |
| 16 | In-app notices + system ticket messages | ~127 | B | **deferred — remains English** |
| 17 | Internal report PDF (staff-only) | 57 | B | **deferred — remains English** |
| 18 | Staff portal | 940 | B | **deferred — remains English** |
| 19 | LIA portal | 524 | B | **deferred — remains English** |
| 20 | Admin / ops / sales | 91 | B | **deferred — remains English** |
| 21 | Agent portal | 17 | B | **deferred — remains English** |

**Item 14 shipped on Vazirmatn (SIL OFL), after two other fonts were ruled out by testing.**
Calibri carries Persian in Regular and Bold but its **Italic has no Arabic glyphs at all**, and
it is licensed with Windows/Office so it cannot be committed. Carlito — the metric-compatible
libre stand-in, and the obvious parallel to the Caladea/Cambria precedent — has **no Persian in
any weight** (1 of 11 codepoints). Metric compatibility turned out to be moot anyway: this
report is set in Helvetica, not Calibri, so there was no Calibri layout to preserve. Vazirmatn
covers Persian and Latin in every weight used, and is already the platform's Persian typeface.

Persian has no italic, so the four passages the English sets in italic use the Vazirmatn **Light**
weight — quieter than body text, where bold would have inverted a soft aside into emphasis.

**The English report is unchanged, asserted byte-for-byte** against a build made before the
refactor (identical apart from the generation timestamp). It stays on Helvetica and embeds no
font. Numerals in the Persian report are deliberately **Latin**: Arabic-Indic digits reverse
inside an RTL run and U+200E does not rescue them.

**Dates stay Gregorian everywhere** — `lib/date.ts` pins Persian to `fa-IR-u-ca-gregory` as a
locked decision (clients cross-reference passport / INZ documents). No Jalali anywhere.

⚠ **All Persian copy remains unverified by a native speaker**, including the 13 strings added
for item 7.

---

## Engineering health

### Backend test suite is flaky in parallel
**FIXED — 14 Aug 2026.** One Postgres schema per Jest worker.

The failures were not badly-written tests. Teardown was already scoped to each suite's own
ids, and the flakiest assertion was already a correct before/after delta. The problem was on
the READ side: a test asserting *"OWNER sees the whole funnel"* legitimately queries every
row, including fixtures another of the 19 workers was mid-way through creating and deleting.
That produced hard failures (`Field contact is required to return data, got null` — a
required relation whose row vanished between the parent read and the relation resolution)
and drifting aggregates (expected 303, received 288). Neither is fixable in a test.

`globalSetup` provisions `test_w<JEST_WORKER_ID>` per worker; `setupFiles` (not
`setupFilesAfterEnv` — specs construct a PrismaClient at module load) points each worker's
`DATABASE_URL` at its own schema; `globalTeardown` drops them.

Measured rather than assumed: parallel `db push` **7.9s**, sequential `migrate deploy` ~51s
(and the 130-migration history will not replay into a fresh schema), reuse-via-TRUNCATE
**43.2s — worse than rebuilding**, because `TRUNCATE CASCADE` takes an ACCESS EXCLUSIVE lock
on each of 127 tables.

Isolation also uncovered a **second, separate finding** — that `prisma db push` does not
reproduce the real schema. It is worth knowing on its own; see the entry below.

Result: **four consecutive parallel runs, 1252/1252, zero failures**, ~31s including setup
versus 54s serial. `--runInBand` still passes. Dev `public` untouched; no schemas leak.

⚠ If a future migration adds a raw-SQL object or seeded table, a test will fail loudly the
way `sla.spec` did — extend `MIGRATION_SEEDED_TABLES` in `test/db-schema.ts`.

### `prisma db push` is silently incomplete against the migration history — KNOWN, 14 Aug 2026

Surfaced by the test-isolation work, but true independently of it and worth stating plainly:
**a schema built by `db push` is not the schema production runs.** `db push` applies
`schema.prisma`; anything a migration did in raw SQL simply is not there, and nothing warns
you.

Two categories found so far, both of which had been masked because the suite ran against a
long-lived migrated dev database:

| Missing | Why Prisma cannot know | What it broke |
|---|---|---|
| **7 partial unique indexes** — `commission_triggers_one_live_per_choice`, `agent_payables_one_live_per_commission`, `consultations_adviser_slot_active_unique`, `wallet_transaction_spend_once_idx`, `wallet_transaction_refund_once_idx`, `refunds_payment_live_once_idx`, `contracts_leadId_active_key` | Prisma has no way to express a `WHERE` clause on an index, so these are hand-written SQL | A test asserting *"a second submission on the same choice is refused"* passed against production and failed against a pushed schema — the constraint doing the refusing did not exist |
| **Migration-seeded reference rows** — `sla_configs` (9 rows), `platform_settings` | `db push` runs no migrations, so their `INSERT`s never execute | `No SLA config for that institution type + stage` |

`test/db-schema.ts` now reconstructs both when provisioning a worker schema. **Why this
matters beyond tests:** anyone using `db push` to stand up an environment — a scratch
database, a demo reset, a new developer's machine — gets a schema missing seven uniqueness
constraints that the application relies on to prevent double-submission and double-payment.
It will look fine until it silently accepts a duplicate.

⚠ **If a future migration adds a raw-SQL object or a seeded table**, the partial-index copy
picks it up automatically (it reads Postgres's own `indexdef`), but a newly seeded table
needs one line added to `MIGRATION_SEEDED_TABLES` in `test/db-schema.ts`. A test will fail
loudly the way `sla.spec` did rather than diverge quietly — that was the deliberate choice.

### Values shared across the server/client boundary — SWEPT 17 Aug 2026
`PAYABLE_STATUSES` was defined in a `'use client'` module and imported by Server
Components; in a production build it arrived as a client *reference*, `.includes()` threw,
a silent catch swallowed it, and the "Outstanding" section never rendered. Fixed in
`c933160`.

**The sweep found no second live instance.** All 16 crossings in the frontend are React
components, which is the supported case. The sweep was validated by running it against
`1ac9eba` — the commit before the fix — where it reported both `PAYABLE_STATUSES` call
sites, so a clean result means it looked and found nothing rather than failed to look.

**One latent hazard was removed:** `PaymentsView.tsx` still re-exported `PAYABLE_STATUSES`
for backwards compatibility. Nothing imported it that way, so it was not a live bug — but a
re-export from a `'use client'` module is indistinguishable at the import site from the
export that caused the original fault, so it was a loaded gun aimed at the same foot.

The sweep is now a **standing test** (`frontend/src/lib/server-client-boundary.test.ts`) —
this class of bug is invisible to `tsc`, invisible in dev, and swallowed by a nearby catch in
production, so a one-off sweep would not have stayed true. It is proven to fail on the
reintroduced pattern. Note for whoever touches it: its first version resolved *zero* imports
because of a Windows path-separator mismatch and passed anyway, which is why it now asserts
that its own resolver works.

---

## University intelligence / pricing

### Import templates + instructions — DONE 17 Aug 2026
`docs/IMPORT_TEMPLATES_GUIDE.md` + `docs/import-templates/*.xlsx`. Plain-English column
reference for all three importers, written from the code. Every sample row was dry-run through
the real endpoints with **zero validation errors**, and each documented failure mode
(`UNRECOGNISED_COUNTRY`, `PERCENTAGE_NOT_VALID_FOR_TUITION`, `MISSING_NAME`, `UNMAPPED_LEVEL`,
`NO_COUNTRY_CONTEXT`, `MISSING_OR_INVALID_AMOUNT`) was verified to actually fire.

Two gaps found and documented rather than assumed:
- **`intakeMonths` is not importable.** The sheet's intake columns populate `ProgrammeIntake`
  (text labels); the `intakeMonths` array the 5-month rule reads is never written by the
  importer. 0% populated in production.
- **`institutionType` has NO write path in the app at all** — no DTO field, no staff UI. Only
  the CLI bulk import sets it, from which source file a provider arrived in. This is why
  production has 0 UNIVERSITY / 1 ITP / 72 PTE / 23 unset, and it cannot be fixed by upload.

### English-course commission split — DONE 17 Aug 2026
`EducationProgramme.isEnglishLanguageCourse` (a separate flag, **not** a QualificationLevel
value — that enum is an academic ladder used by tuition matching and the Q30 progression rule)
plus nullable `commissionEnglishY1/Y2Type/Value` on `EducationProvider`. Null ≠ 0: null means
"no separate English rate", a stored 0 is a real agreement.

`resolveCommissionRate()` picks English → provider → none. Wired so an explicitly supplied rate
still wins, which leaves both existing callers byte-identical. Verified with real commission
rows: English 25%, non-English 15%, explicit override honoured, English course at an
institution with no English rate falls back to 12%. Migration is purely additive and **does not
touch `commissions`**, so existing snapshots cannot move — asserted by changing the institution
rate and re-reading the row (25 → 25). 13 unit tests.

### Recommendations in Apply/Study — PHASE 0 DONE 17 Aug 2026; phases 1–3 unscheduled
`docs/PLAN_RECOMMENDATIONS_IN_APPLY_STUDY.md`. Plan approved as written.

**Phase 0 shipped** — the three unblockers:
- **`institutionType` write path.** Added to `UpdateProviderDto` and the institution edit
  screen. `providerType` follows it (UNIVERSITY / ITP→POLYTECHNIC / PTE→COLLEGE) unless the
  caller states it, so the two spellings of one fact cannot drift the way they could before.
- **NZ `CountryExecutionConfig` seed** — `backend/scripts/seed-country-execution-config.ts`,
  idempotent and report-only without `--apply`. Values are the code's own fallbacks (5 / 12 /
  4, slotCount 5), so it is a **no-op by construction**. `slotRules.enabled` stays false and
  `institutionTypeWeighting` is seeded **empty on purpose**: `softScore()` adds a sixth
  scoring component only when a non-empty weighting exists, so a populated one would have
  silently re-ranked every recommendation.
- **Readiness indicator** on `GET /staff/settings/country-config/:code` —
  total / categorised / uncategorised / byType / typesWithNoInstitutions. Information, not
  automation: a human still decides when to enable the slot rule. Deliberately no
  auto-activating gate.

Verified in a real browser end to end: setting an institution's type through the staff screen
persists it and keeps `providerType` in step; the readiness numbers match a direct database
count; the seed's create path produces exactly the fallback values and re-running changes
nothing. The test institution was restored to its original values.

**Also closed a gap in the English-commission work:** `UpdateProviderDto` had no
`commissionEnglishY1/Y2` fields, so the rate added earlier could not actually be set. DTO and
edit screen now carry it — blank means "no separate English rate", and clearing it sends null
rather than 0.

**Phase 1 shipped 17 Aug 2026** — read-only suggestions in Apply/Study Step 1.

Product decisions locked: suggestions appear **after** the student makes their own choice (never
before), **5** of them, and only programmes they are **eligible** for.

Reuses the existing matcher and `RecommendationList` persistence — no scoring is duplicated —
and the "why" chips are the stored deterministic `whyThisFits` dimensions passed through
untouched. No AI prose, no model call in the path.

Three guarantees, each enforced on the SERVER rather than only in the UI:
- **Timing.** With no choice on record the endpoint returns `available: false` and an empty
  list, before any list is even fetched. Suggestions cannot precede the student's decision even
  if a screen called too early.
- **Read-only.** The path never creates, updates or deletes an `AdmissionProgrammeChoice`; the
  only access is the read that gates on timing. A suggestion is not a commitment.
- **Count independence.** `SUGGESTION_COUNT` is its own constant, deliberately NOT
  `CountryExecutionConfig.slotCount` — which is also 5 today, and is the *choice* limit, a
  different question. A test asserts the two never get coupled.

Verified as a real student, 12/12: nothing before the choice, exactly 5 after, the chosen
programme never suggested back, every suggestion inside the matcher's eligibility-filtered
output, an excluded programme absent at the boundary, the explanation byte-identical to the
stored breakdown, and no choice created by viewing. The student's original choices were
restored.

**Phases 2–3 unscheduled.** Question 4 (Phase 3 mandatory-slot policy) stays **open and parked**
pending institution categorisation — 23 institutions are still uncategorised, which Phase 0 made
fixable for the first time.

---

## Blocked / awaiting someone else

- **Agent Portal Phase 3** — DocuSeal contract signing for agents. Plan approved; held for
  the real template (id, party names verbatim, prefill field names including the rate
  label). Six decisions recorded.
- **DocuSeal engagement-letter wording** — the Owner was checking whether the template
  states a fee; it lives in DocuSeal's editor, outside the repo, so the GST correction did
  not cover it.
