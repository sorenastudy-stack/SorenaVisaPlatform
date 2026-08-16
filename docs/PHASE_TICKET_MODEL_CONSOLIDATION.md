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

**Removed — the kanban raise-ticket path** (follow-up, 15 Aug 2026; see §7)
- `src/kanban/kanban.controller.ts` — `POST /staff/tickets`
- `src/kanban/kanban.service.ts` — `createStaffTicket`
- `src/kanban/dto/staff-ticket.dto.ts` — deleted, orphaned
- `src/kanban/co-kanban.spec.ts` — the raise-ticket case
- `frontend/src/components/staff/kanban/KanbanClient.tsx` — the button, its modal
  and the `DEPARTMENTS` constant that fed it

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

**The kanban "raise a ticket" action was REMOVED — decided, not deferred.**

The plan called for porting it to `VisaSupportTicket`. The code carried an explicit reason
not to:

> *"Uses the CRM-keyed generic Ticket (contactId + optional CRM caseId) — NOT
> VisaSupportTicket, which is hard-locked to a VisaCase + student account and so can't serve a
> pre-contract lead card."*

`VisaSupportTicket` requires both a `User` and a `VisaCase`; a pre-contract lead has neither —
and 99 of the 100 legacy rows had neither, confirming that was the real usage. Porting would
have meant removing that capability anyway, or fabricating a VisaCase for an unsigned lead and
polluting the case pipeline.

**What settled it: the surface never worked.** Tickets raised from the kanban went into a table
the staff queue does not read, so they reached nobody. They were visible only in the CLIENT
list, and only by way of the route collision this phase fixed. There was no working workflow
to preserve — so rather than relax the canonical model to accommodate it, the Owner decided
(15 Aug 2026) that raising a ticket against a pre-contract lead is not a workflow the platform
supports, and it was removed.

Removed: the "Raise ticket" button and its modal in `KanbanClient.tsx`, `POST /staff/tickets`
in `kanban.controller.ts`, `createStaffTicket` in `kanban.service.ts`, the now-orphaned
`dto/staff-ticket.dto.ts` and `DEPARTMENTS` constant, and the spec that covered it.

That spec is incidentally where dev's 99 `"Missing passport scan"` rows came from: it wrote a
real `Ticket` on every run against the then-shared database, and nothing cleaned them up.

Verified after removal: `POST /staff/tickets` no longer appears in Nest's route map while the
staff queue's own routes and `GET /staff/kanban` remain; the board renders with no "Raise
ticket" action, no failed backend calls and no console errors; the staff ticket queue still
loads. 1251 tests / 104 suites.

**Nothing in the backend now reads or writes `Ticket` / `TicketMessage`.**

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
