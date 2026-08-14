# Phase — Ticket model consolidation

**Date:** 14 August 2026
**Status:** built and verified
**Decision:** `VisaSupportTicket` is canonical. `Ticket` / `TicketMessage` are retired —
left in the database, no longer read or written by the client surfaces.

## 1. What this phase does

The platform had two ticket systems, and the client portal was reading the wrong one because
of a **route collision** rather than a deliberate choice.

`StudentsController` (`@Controller('students')` + `@Get('me/tickets')`) and `TicketsController`
(`@Controller('students/me/tickets')`) registered the **same four paths**. Nest resolved the
first at position 32 and the second at 36, so Express served the older one and
`TicketsController` — written against the canonical model — never received traffic. That is
why `visa_support_tickets` sat empty while the legacy table accumulated rows.

Three client-facing defects fell out of that, all fixed here:

- **A client could not close a ticket.** `PATCH :id/close` was the *only* route reaching
  `TicketsController`, so it looked the id up in the other table: `404 "Ticket not found"`,
  status unchanged.
- **`tickets.department.null` rendered as a badge** — only the legacy model allows a null
  department.
- **An empty "Reply:" label** — `TicketListItem` reads `messageCount`, which the legacy shape
  does not have.

The client UI was already built for `VisaSupportTicket`. Only the backend was misrouted.

## 2. Files created or changed

**Changed — backend**
- `src/students/students.controller.ts` — four `me/tickets` handlers removed
- `src/students/students.service.ts` — their four methods removed (148 lines)
- `src/students/admission/admission.service.ts` — `maybeCreateEnglishPreCourseTicket`
  deleted; the notice routes through `notifyAdmissionTicket`

**Changed — frontend**
- `src/app/student/page.tsx` — the home "latest message" widget reads the real payload
- `src/i18n/messages/{en,fa}.json` — one key, `studentHome.messageCount`

**Not changed, deliberately:** `src/kanban/kanban.service.ts` — see §7.

## 3. Database tables/columns added

**None. No migration, no backfill, no deletion.**

`Ticket` and `TicketMessage` keep their rows and their schema definitions; nothing references
them from the client path. The `department` backfill the plan allowed for was never needed —
see §6.

## 4. Environment variables added

**None.**

## 5. Third-party services connected

**None.**

## 6. How to test it works

Row counts made this cheap. **Production and demo both hold zero legacy rows**, so there was
nothing to migrate:

| | dev | production | demo |
|---|---|---|---|
| `Ticket` | 100 | **0** | **0** |
| `TicketMessage` | 1 | **0** | **0** |
| `VisaSupportTicket` | 0 | 1 | 1 |

Of dev's 100 rows, 99 were **test residue** — accumulating daily (5, 17, 25, 23, 29) with
distinct `co.ck…@t.local` creators from the kanban spec writing into the shared dev database.
Per-worker schema isolation (shipped the same day) stops that at source.

Verified, in this order:

1. **Route collision gone.** Nest's boot log maps `/students/me/tickets` exactly once, under
   `TicketsController`, with all five routes including `PATCH :id/close`.
2. **Client journey over real HTTP — 16/16.** Create → list → detail → reply → close, as a
   real STUDENT. Asserted the subject is **ciphertext at rest** (48 bytes for a 19-character
   subject, and the plaintext does not appear in the column) and **decrypted on read**; that
   `department` is stored non-null; that **no legacy row is created**; and that the same
   ticket appears in the staff queue.
3. **The 404 is gone**: `PATCH …/close` → **200**, status `OPEN → CLOSED`, `closedAt` stamped.
4. **English pre-course flow — 5/5.** `notifyAdmissionTicket` finds-or-creates the
   `ADMISSIONS` thread, carries the message, **appends on a repeat call rather than opening a
   second thread**, and writes no legacy row.
5. **Browser, both locales — 12/12.** The list shows the ticket, the department badge renders
   a real label (`Payments & finance` / `پرداخت‌ها`), **no raw i18n key anywhere**, the
   "Reply:" label has a value, and the student home renders on the new payload. No console
   errors.
6. **1252 tests / 104 suites.**

## 7. Known limitations

**⚠ `kanban.service.ts` still writes `Ticket`, deliberately — this needs an Owner decision.**

The plan called for porting it. The code carries an explicit reason not to:

> *"Uses the CRM-keyed generic Ticket (contactId + optional CRM caseId) — NOT
> VisaSupportTicket, which is hard-locked to a VisaCase + student account and so can't serve a
> pre-contract lead card."*

`VisaSupportTicket` requires both `clientId` (a User) and `caseId` (a VisaCase). A
pre-contract lead has neither. The dev data agrees: 99 of 100 legacy rows have **no case and
no login**. Porting as specified would either remove staff's ability to raise a ticket against
a pre-contract lead, or fabricate a VisaCase for someone who has not signed — which would
pollute the case pipeline.

**Note this surface is already half-broken independently.** Kanban-raised tickets never
appeared in the staff ticket queue (that reads `VisaSupportTicket`); they were only ever
visible in the client list, by way of the same collision. After this change they are written
and read by nobody.

Three ways forward, for the Owner:
1. **Relax the model** — make `VisaSupportTicket.caseId` nullable and key the owner on Contact
   rather than User. Migration; serves pre-contract leads properly.
2. **Keep `Ticket` for the CRM surface** — accept two models with a documented split: leads vs
   signed clients. Nothing to build, but the name "retired" stops being true.
3. **Drop the feature** — if raising a ticket on a pre-contract lead is not a real workflow,
   remove the endpoint and the kanban action.

**The legacy tables remain populated in dev** (100 rows), unreachable. Left alone on purpose:
no `DROP`, no `DELETE`.

## 8. How a future developer would extend this

Client ticket work belongs in `students/tickets/` against `VisaSupportTicket`. Staff ticket
work belongs in `staff/tickets/` against the same model. There is no longer a second client
path.

**Watch for route collisions.** This bug was invisible in code review — both controllers read
correctly in isolation. What exposed it was Nest's boot log, which maps the same path twice
without complaint. If a route behaves as though its handler is not running, check
`RouterExplorer` output before checking the handler.

`notifyAdmissionTicket` is the way to post a system notice into a client's thread: it
find-or-creates the `ADMISSIONS` thread, creates the `VisaCase` if absent, and appends. It is
best-effort by contract and returns silently when the case or author cannot be resolved — so
callers must not rely on it having written anything.

## 9. Security layers applied

**Subject and body are encrypted at rest.** The canonical model stores `subjectEncrypted` /
`bodyEncrypted` as `Bytes` via `CryptoService`. The legacy model stored both in plaintext, so
this consolidation moves client support conversations from cleartext columns into encrypted
ones — verified, not assumed: the probe's plaintext does not appear in the stored column.

**Ownership is unchanged and still server-side.** `TicketsController` resolves the caller's
tickets from the JWT; a foreign ticket id answers not-found. The rate-limit guards
(`ticket-rate-limit.guards.ts`) already sat on the canonical routes and now actually apply,
since those routes are reachable for the first time.

**No data was destroyed.** Both legacy tables and every row survive. Backups of both tables
from dev and production were taken to the session scratchpad before any change.

## 10. Rollback instructions

Revert the commit. The four handlers and their service methods return, `StudentsController`
resumes shadowing `TicketsController`, and the client portal reads `Ticket` again — with the
close-ticket 404 and the null-department badge back.

**Nothing needs unwinding in the database.** No migration ran, no rows were written to or
removed from either legacy table, and any `VisaSupportTicket` rows created after this ships
remain valid — they are the canonical model either way, and the staff queue reads them
regardless of which client route is live.
