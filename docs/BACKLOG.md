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

### Two ticket models — INVESTIGATED 14 Aug 2026; consolidation onto `VisaSupportTicket` DECIDED, plan pending review

**Root cause: a route collision, not a data-model mystery.** Two controllers register the
same four paths, and Express serves whichever registered first:

| Controller | Path | Model | Wins? |
|---|---|---|---|
| `StudentsController` (`@Controller('students')` + `@Get('me/tickets')`) | `/students/me/tickets` | `Ticket` | **yes** — resolves 1st |
| `TicketsController` (`@Controller('students/me/tickets')`) | `/students/me/tickets` | `VisaSupportTicket` | no — shadowed |

Nest's boot log settles it: `StudentsController` resolves at position 32, `TicketsController`
at 36. `TicketsController`'s `GET`, `GET :id`, `POST` and `POST :id/messages` are
**unreachable dead code**. Only `PATCH :id/close` reaches it.

**Live bug this causes: a client cannot close a ticket.** The list/detail come from `Ticket`,
but close is the one route reaching `TicketsController`, which looks the id up in
`VisaSupportTicket`:

```
PATCH /students/me/tickets/<id>/close  ->  404 "Ticket not found"
Ticket status after: OPEN (UNCHANGED)
```

It also explains two audit findings: `tickets.department.null` (only `Ticket.department` is
nullable) and the empty "Reply:" label (`TicketListItem` expects `messageCount`, which the
`Ticket` shape does not have).

**Row counts — the decisive fact.** The legacy table is empty everywhere that matters:

| | dev | production | demo |
|---|---|---|---|
| `Ticket` | 100 | **0** | **0** |
| `TicketMessage` | 1 | **0** | **0** |
| `VisaSupportTicket` | 0 | **1** | **1** |
| `VisaSupportTicketMessage` | 0 | **1** | **1** |

So there is **no production data to migrate**. Of the 100 dev rows, 99 are test residue —
accumulating daily (5, 17, 25, 23, 29) with distinct `co.ck…@t.local` creators from the
kanban spec writing into the shared dev database. Today's per-worker schema isolation stops
that accumulation at source.

**History.** `Ticket` — `855fda5`, 1 May 2026 ("scaffold Student portal"). `VisaSupportTicket`
— `e7cf818`, 20 May 2026 ("PR-DASH-2 Support tickets"). No commit, comment or TODO says one
replaces the other, but `VisaSupportTicket` carries the design rationale (encrypted subject,
null-on-staff-deletion), owns the entire staff workflow, and received the later feature work
(`PHASE_R_TICKETS_RICH_ATTACHMENTS.md`). The evidence reads as: PR-DASH-2 built a complete
replacement, nobody removed the old routes, and the new controller was silently shadowed at
boot — which is exactly why its table stayed empty.

**DECIDED (Owner, 14 Aug 2026): `VisaSupportTicket` is canonical. `Ticket`/`TicketMessage`
are retired — left in the database, but nothing writes to them.** Full migration plan
prepared and awaiting review; the one judgment call in it is the default department for rows
whose `department` is null.

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
