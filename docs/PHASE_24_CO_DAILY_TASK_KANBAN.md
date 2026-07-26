# Phase 24 — Client Officer Daily Task Kanban

End-of-phase handover for the Client Officer (CO) daily task **kanban** — a single
journey board for a CO's clients from pre-contract nurturing through case handling,
with a pre-contract **manual override** (advance/postpone, audited) and a per-card
**raise-ticket**. This is a separate feature from the earlier SLA/deadline discussion
(that overdue-day-counter work stays deferred — see §7).

**Date:** 2026-07-27
**Commit (this phase):**
- `3f35caa` — feat(kanban): Client Officer daily task kanban + pre-contract nurture override + staff tickets

---

## 1. What this phase does

A single board (`/staff/kanban`, "My clients") over a CO's clients across the **whole
journey**, one card per client:

- **Columns:** `Nurturing → Ready to refer → Admission → Visa → INZ submitted →
  Completed → Withdrawn`.
- **Pre-contract leads** (Nurturing, Ready to refer) are **editable** by the CO; from
  **Admission onward everything is read-only** (handed off to Admission Office / LIA)
  — the CO keeps full visibility but can't change it.
- **Collapsed automation:** the whole automated nurture email sequence is one
  read-only "Nurturing" column — it was already collapsed into `Lead.nurtureStage`
  (there are no per-step workflow rows), so nothing needed splitting.
- **Interaction is dropdown-driven, not drag** (per the brief — avoids ambiguity).
- **Manual override (pre-contract only, mandatory reason, audited):**
  - **Advance** — end automated nurturing early + ready the lead for referral
    (`nurtureStage → ENDED`).
  - **Postpone** — hold nurturing for a CO-chosen number of days
    (`Lead.nurtureHeldUntil`); the daily nurture cron **skips held leads** until then.
  - Both write an `AuditLog` row (`NURTURE_MANUALLY_ADVANCED` / `_POSTPONED`,
    `newValue { from, to, reason }`), visible in the existing `/admin/audit`.
- **Per card:** open the client's lead/case file + **raise a department-routed ticket**.
- **Scope:** a CO sees only their own clients; **admin tier (OWNER/SUPER_ADMIN/ADMIN)
  sees all**.

## 2. Files created or changed

Pulled from `git show --stat 3f35caa`.

*Created*
- `backend/prisma/migrations/20260727120000_pr_co_kanban/migration.sql`.
- `backend/src/kanban/kanban.service.ts` — `getKanban` + `createStaffTicket`.
- `backend/src/kanban/kanban.controller.ts` — `GET /staff/kanban`, `POST /staff/tickets`.
- `backend/src/kanban/kanban.module.ts`, `dto/staff-ticket.dto.ts`.
- `backend/src/kanban/co-kanban.spec.ts` — DB-backed spec (5).
- `frontend/src/app/staff/kanban/page.tsx`, `frontend/src/components/staff/kanban/KanbanClient.tsx`.

*Changed*
- `backend/prisma/schema.prisma` — `Lead.nurtureHeldUntil`, `Lead.nurtureHoldReason`;
  `Ticket.department` (nullable, `VisaTicketDepartment`).
- `backend/src/nurture/nurture.service.ts` — `manualOverride()` + the sweep now skips
  held leads (`nurtureHeldUntil > now`).
- `backend/src/nurture/nurture.controller.ts` + `dto/nurture.dto.ts` — `POST
  /staff/nurture/:leadId/override`.
- `backend/src/app.module.ts` — register `KanbanModule`.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — "My clients" nav item.

## 3. Database tables / columns added

Additive only — **no new tables, no CaseStage change, no stage-history table** (all
deferred):
- `leads.nurtureHeldUntil` (DateTime?) + `leads.nurtureHoldReason` (text) — the CO
  postpone hold.
- `tickets.department` (`VisaTicketDepartment`?, nullable) — routing for staff/CO
  raised tickets; existing student-admission tickets don't set it.

## 4. Environment variables added (names only)

**None.**

## 5. Third-party services connected

**None.**

## 6. How to test it works

**Automated** — `co-kanban.spec.ts` (DB-backed, 5/5 green):
1. **Advance** ends nurturing (`stage → ENDED`) + writes the audit row with the reason.
2. **Postpone** holds the lead + audits (`holdDays`), and a sweep while held **does
   not process the lead** (no new email-ledger rows); once the hold passes, the sweep
   **resumes** (due emails send).
3. Override is **rejected once a contract exists** (pre-contract only) and **requires a
   reason**.
4. **Raise-ticket** creates a `Ticket` with the chosen `department` + contact + OPEN.
5. **Kanban scoping** — a CO sees only their own clients; a second CO can't see the
   first's; admin sees all; case columns are `editable: false`.

Backend `tsc` + `next build` clean; `/staff/kanban` builds.

**Manual:**
1. As a **Client Officer**, open **My clients** (`/staff/kanban`). Your pre-contract
   leads sit under **Nurturing** / **Ready to refer**; your cases under Admission →
   Completed (read-only, lock icon).
2. On a Nurturing card → **Move → Postpone nurturing…** → enter a reason + days → the
   card shows "On hold until …"; the nurture cron skips it until then. **Move →
   Advance** → reason → the lead ends nurturing and lands in **Ready to refer**.
3. On any card → **Raise ticket** → pick a **department** + subject → a ticket is
   created for that client.
4. As **OWNER/ADMIN**, check `/admin/audit` filtered to `NURTURE_MANUALLY_ADVANCED` /
   `NURTURE_MANUALLY_POSTPONED` — every override with its actor + reason.
5. As a **different CO**, confirm you see only your own clients; as admin, all.

## 7. Known limitations / future work

- **Ticketing model deviation (read this).** The brief asked to reuse the
  department-routed `VisaSupportTicket`. That model is **hard-locked to a `VisaCase` +
  a student `User` account**, and a **pre-contract lead card has neither** — so it
  literally cannot create one. To make "raise a ticket from *any* card" work, the
  staff endpoint uses the **CRM-keyed generic `Ticket`** (contactId + optional CRM
  caseId, which fit both leads and cases) and **reuses the `VisaTicketDepartment`
  enum** for routing — so departments match the visa-support queue, only the table
  differs. If you'd rather restrict ticketing to enrolled visa-cases (and drop it from
  pre-contract lead cards), switch the endpoint to `VisaSupportTicket`. Staff-raised
  tickets currently have **no dedicated staff inbox view** — they exist + are audited;
  surfacing/answering them is a follow-up.
- **The SLA/deadline overdue day-counter is NOT part of this** and stays deferred
  (Phase 22 Fork C): a `Case.stageEnteredAt` + a fixed-SLA-per-stage rule to show
  "days overdue" per stage, and the OWNER by-officer overdue report. This kanban is the
  journey/override board, not the SLA board.
- **"Ready to refer" is derived, not a stored state:** a pre-contract lead with a
  completed FREE_15, no case, no contract, and `nurtureStage ∈ {NONE, ENDED}`. There's
  no explicit "referred" flag; the lead leaves the board when it gains a case/contract.
- **Advance is one-way** (ends nurturing). There's no "un-advance"; re-enrolling uses
  the existing nurture enroll flow.
- **Postpone is bounded** (1–365 days, required) — no indefinite hold, by design.
- **Case-stage transitions aren't editable here** (read-only past Admission), so **no
  `CaseStage` state machine was defined** — deferred until a surface actually drives
  case stages.

## 8. How a future developer would extend this

- **Add the SLA overdue counter:** add `Case.stageEnteredAt` (stamp at the ~6 stage
  writes) + a fixed-SLA-per-stage map; compute `daysOverdue` and render a red counter
  on case cards + a by-officer report (that's the deferred Phase-22 Fork C).
- **Staff ticket inbox:** build a staff view over `Ticket where department = …`
  (the data + routing already exist).
- **More override kinds:** `manualOverride` in `NurtureService` is the single place;
  add directions there (keep the mandatory-reason + audit pattern).
- **Editable case stages (if ever wanted):** define a `CaseStage` transition map + a
  guarded stage-change endpoint, and flip the relevant columns to `editable`.

## 9. Security layers applied

- **Role-gated + self-scoped.** `/staff/kanban` + `/staff/tickets` +
  `/staff/nurture/:leadId/override` are gated to CO + admin tier; `getKanban` scopes to
  the caller's own clients (via the FREE_15 assignee for leads, `consultantId` for
  cases), admin tier excepted. The frontend page also server-checks the session.
- **Override is pre-contract-only + reason-mandatory + fully audited** — a contract
  existing blocks it, an empty reason is rejected, and every advance/postpone writes an
  `AuditLog` row with the actor snapshot, so OWNER/ADMIN can review who accelerates/
  delays leads and why (money/process-sensitive action → audit).
- **Postpone is bounded** (≤ 365 days) — no indefinite suspension of a lead.
- **Ticket create validates the contact** and records a `TICKET_RAISED_BY_STAFF` audit.
- **The nurture hold is enforced in the sweep query**, not just the UI — a held lead is
  physically excluded from processing until `nurtureHeldUntil`.

## 10. Rollback instructions

Additive migration — a straight git revert; the columns can be left in place.

1. **Full revert:** `git revert 3f35caa`. Removes the kanban module + page + nav, the
   override endpoint/logic, and the sweep-skip guard; reverts the nurture DTO/controller.
   The two `Lead` columns + `Ticket.department` remain in the DB (additive, unused) —
   drop separately only if desired.
2. **Partial (keep override, drop the board):** delete `frontend/src/app/staff/kanban`
   + the nav item + the `KanbanModule` registration — the override endpoint + sweep
   skip stay.
3. **No data / env / service cleanup** — there is none; any leads currently held simply
   resume once `nurtureHeldUntil` passes (or clear the field).
