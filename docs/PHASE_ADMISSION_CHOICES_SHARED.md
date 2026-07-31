# PR-ADMISSION-SHARED — shared programme-choice list (student + Admission Officer)

Gives the **Admission Officer (CONSULTANT)** full CRUD over the **same**
`AdmissionProgrammeChoice` list the student edits in Apply/Study Step 1 — one
shared list, both sides act on it — plus a durable case-history record of every
change and a student notification for staff-originated changes.

**Date:** 2026-08-01
**Status:** built + verified (freeze battery + integration smoke 13/13).
**Explicitly NOT touched:** the existing student Step-1 picker's behaviour (only
additive history logging), and PR-RECS-2 / `PrioritySlot` (stays parked, separate).

---

## 1. The logging / notification matrix (read this first)

| Who acts | What they do | Case history (AuditLog, `entityType:'CASE'`, `entityId:caseId`) | Student notified (ticket)? |
|---|---|---|---|
| **Student** (Apply Step 1) | add / remove / reorder | ✅ logged, `actorSide:'STUDENT'` | ❌ **No** — self-edit, no one notified |
| **Admission Officer** (staff) | add / remove / reorder | ✅ logged, `actorSide:'STAFF'` | ✅ **Yes** — one `ADMISSIONS` ticket thread, a `SYSTEM` message per action |

**Key properties a future dev must know:**
- **One shared list.** Both sides read/write the *same* `AdmissionProgrammeChoice`
  rows (on the case's `AdmissionApplication`). There is no second list.
- **Complete, unified history.** *Every* change — student **and** staff — lands in
  the **same** case audit trail (`AuditLog`, CASE-scoped), so the history is a full
  record regardless of who acted. `actorSide` in the payload distinguishes them;
  the summariser renders "Student …" vs "Admission Specialist …".
- **Notification is one-directional.** Officer action → student gets a ticket.
  Student action → **nobody** is notified (but it IS still logged to history, for
  future analytics / dispute resolution / audit).
- **Logging is best-effort.** A history/notification failure only warns — it never
  fails the underlying add/remove/reorder.

## 2. Access control

- **Student** — unchanged: `/students/admission/application/programme-choices*`,
  student JWT, resolves the case from `userId`. **Still locked after the
  application is SUBMITTED** (student can't edit a submitted application).
- **Officer (new)** — `/staff/cases/:caseId/programme-choices` (`GET` / `POST` /
  `DELETE :choiceId` / `PATCH reorder`), `JwtAuthGuard + RolesGuard` +
  `@Roles('OWNER','SUPER_ADMIN','ADMIN','CONSULTANT','CLIENT_CONSULTANT')` — the
  standard case-scoped staff pattern. **No status lock — staff are the curator
  role and can edit at any time, including post-submission** (per decision D).

## 3. Case-history record — which mechanism, and why

Canonical history = **`AuditLog` rows with `entityType:'CASE', entityId:<CRM caseId>`** —
the same pattern `case-conversation-notes`, `case-documents`, `case-messages`, and
`cases.service` already use, and what the CRM-case timeline reads
(`case-file-note.service`). Chosen over `VisaCaseFileNote` because it's
**CRM-Case-scoped with no `VisaCase` dependency**, it's the durable audit trail the
requirement targets, and it already flows into the staff case-detail **Activity
tab** via the `audit.helper` summariser (extended here with the three
`PROGRAMME_CHOICE_*` event types).

## 4. Notification — how

One persistent **`ADMISSIONS` `VisaSupportTicket`** per case (the student's
"Messages & support"): **find-or-create** the open thread, append a **`SYSTEM`-authored**
message (author id = the officer, so it's attributable but renders as an auto-notice)
per action, e.g. *"Your Admission Specialist added [Provider — Programme] to your
application list."* Subjects/bodies are encrypted (existing `CryptoService`). The
ticket hangs off `VisaCase`, so the notifier resolves-or-creates the `VisaCase`
(`Case → AdmissionApplication → VisaApplication → VisaCase`, mirroring
`ensureDashboardRows`).

## 5. Files

- `students/admission/programme-choice-notice.ts` — pure copy + audit-payload
  builders, shared by both sides (freeze-tested).
- `students/admission/admission.service.ts` — student add/remove/reorder now write
  history (best-effort; no ticket).
- `staff/admission-choices/` — `StaffAdmissionChoicesService` (+ controller, dto,
  module): case-scoped CRUD, no lock, history + notification.
- `common/audit/audit.helper.ts` — summariser cases for the 3 event types.

## 6. Verification

- **Freeze battery** (`programme-choice-notice.spec.ts`, 5 cases): exact student
  microcopy, the CASE-scoped audit payload per action, and the summariser rendering
  "Student …" vs "Admission Specialist …" from the same rows.
- **Integration smoke 13/13** (real DB): student add → 1 choice + 1 STUDENT history
  + **0 tickets**; staff add → **shared** list grows + STAFF history + ticket
  message; staff reorder+remove → 3 STAFF history + **3 messages in one thread**;
  unified history = 4 (1 student + 3 staff); ticket body = exact human microcopy,
  `SYSTEM`-authored; **staff edits post-SUBMITTED (no lock)** while the **student is
  blocked**.
- Matching + scoring gate 95/95; backend build clean.

## 7. Concurrency note

`priority` is a plain `Int` (`count+1` on add), not `@@unique`. Concurrent
student+staff adds could momentarily share a number; any reorder renormalises, and
last-write-wins on reorder is fine for a priority list. Not a real risk.

## 8. Not in scope / next

- **No staff UI yet** — endpoints only. The Admission Officer's programme-choice
  editor (in the staff case detail) is the natural next build; it reuses the same
  `/public/programmes` catalogue the student picker uses.
- **PR-RECS-2 (`PrioritySlot`)** remains parked and separate — not wired here.
- **Intake-window rule** (5–12 month, conditional-offer warning) from the prior
  discussion is a **separate** piece, not part of this PR.
