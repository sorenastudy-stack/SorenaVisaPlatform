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
- **Still open — the shared rate-limit bucket.** `apiServer` forwards no client IP, so every
  client's server-rendered calls hit the backend from the frontend service's own address and
  share one 60/60s bucket; the shell spends ~4 requests per page render. Fixing the symptom
  did not fix this. Worth doing before traffic grows.
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
- **Follow-up question for the Owner (not blocking):** should `/student/meetings` eventually
  be merged into Booking rather than living as a separate destination? Adding it to the
  sidebar was the safe default under the new rule; whether it deserves standalone billing is
  an information-architecture decision.

### Two ticket models, and the portal reads different ones — NEW, 14 Aug 2026

Found while re-verifying audit finding 1b. **Not investigated further; recorded so it does
not have to be rediscovered.**

The schema carries two unrelated ticket systems:

| | `Ticket` (schema ~3008) | `VisaSupportTicket` (schema ~4615) |
|---|---|---|
| rows in dev | **90** | 0 for the test client |
| `subject` | plaintext `String` | `subjectEncrypted`, decrypted on read |
| `department` | **nullable** | NOT NULL |
| companion | `TicketMessage` | `VisaSupportTicketMessage` |

What was observed, not inferred:

- The dashboard card counts **`VisaSupportTicket`** (`TicketsService.getDashboardSummary`).
- `/student/tickets` displayed *"English pre-course consultation requested"* — a row that
  exists **only in `Ticket`**, for a client with **zero** `VisaSupportTicket` rows.
- Creating a properly-encrypted `VisaSupportTicket` probe made the dashboard count **1**
  while the page **kept showing the `Ticket` row instead**. Probe removed afterwards.
- `Ticket.department` being nullable is exactly where the original
  `tickets.department.null` badge came from — a null that the other model cannot produce.

**Unresolved and worth starting from:** `/student/tickets` fetches `/students/me/tickets`,
and that controller's service reads `visaSupportTicket` — so the code path that served a
`Ticket` row to that page has not been identified. Either another route answers that path,
or the page reaches something else. That is the first thread to pull.

Questions for whoever picks it up: which model is the client-facing one, is the other legacy,
and does anything still write to both?

### Persian / RTL
Six-item queue in the audit doc: Explore (242 English words), Recommendations (61), the
14-step admission forms (52), two shell strings on every page, un-localised relative times
and ISO dates, and the "What to do next" block.

⚠ **All Persian copy added on 13 Aug 2026 is unverified by a native speaker.**

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

**Two things `db push` does not reproduce, both discovered by tests failing:**
- **7 partial unique indexes** (`commission_triggers_one_live_per_choice` and siblings).
  Prisma cannot express a `WHERE` on an index, so they exist only in migration SQL. Now
  copied from the source schema using Postgres's own `indexdef`, executed with `search_path`
  set to the target so enum casts resolve locally.
- **Migration-seeded reference rows** (`sla_configs`, `platform_settings`). Copied with enum
  columns cast through text, because each schema owns a distinct copy of every enum type.

Result: **four consecutive parallel runs, 1252/1252, zero failures**, ~31s including setup
versus 54s serial. `--runInBand` still passes. Dev `public` untouched; no schemas leak.

⚠ If a future migration adds a raw-SQL object or seeded table, a test will fail loudly the
way `sla.spec` did — extend `MIGRATION_SEEDED_TABLES` in `test/db-schema.ts`.

### Values shared across the server/client boundary
`PAYABLE_STATUSES` was defined in a `'use client'` module and imported by Server
Components; in a production build it arrived as a client *reference*, `.includes()` threw,
a silent catch swallowed it, and the "Outstanding" section never rendered. Fixed in
`c933160`. **Other values may cross the same boundary the same way** — worth a sweep for
server components importing non-type, non-component exports from `'use client'` files.

---

## Blocked / awaiting someone else

- **Agent Portal Phase 3** — DocuSeal contract signing for agents. Plan approved; held for
  the real template (id, party names verbatim, prefill field names including the rate
  label). Six decisions recorded.
- **DocuSeal engagement-letter wording** — the Owner was checking whether the template
  states a fee; it lives in DocuSeal's editor, outside the repo, so the GST correction did
  not cover it.
