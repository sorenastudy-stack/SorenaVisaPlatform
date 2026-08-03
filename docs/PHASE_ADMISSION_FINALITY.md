# PR-ADMISSION-FINALITY — Step 7: the "choices are final" signal

**Status:** BUILT + VERIFIED (2026-08-03). Backend-only (no frontend surface). This is the real
emitted signal for the moment Steps 2b–6 have all been *reading* (`status === SUBMITTED`) but which
never existed as something a consumer could listen for.

## State of play before this step
`submitApplication` ran validations then an atomic `$transaction` (array form) that set
`application.status = SUBMITTED` + `submittedAt`, `case.status = APPLICATION_SUBMITTED`, and wrote an
`AuditLog` row — plus post-commit non-fatal emails + the intake-reassignment check. **No `CrmEvent`
was emitted.** Every downstream system (CV/SOP localisation, submission-log start, the sequential
gate, the follow-up sweep) merely *pulls* `status === SUBMITTED`; there was no *push*.

## What shipped (Owner decisions 2026-08-03)
- **Mechanism: a `CrmEvent` via `EventsService.emit`** — the established emission convention (an
  outbox row: `processingStatus`, `leadId` for the CRM timeline, `payloadJson`). Event types are free
  strings; there is **no outbox processor draining `crm_events` yet**, so this is **emit-only** — like
  the deleted `PRIORITY_SLOTS_CONFIRMED`, the emission *is* the deliverable (consumers can attach
  later without a migration).
- **Emitted in-transaction (atomic).** The array-form `$transaction` became an interactive one so
  `emit` runs on the same `tx` client. The signal fires **iff** the `SUBMITTED` flip commits — it can
  never be lost, nor fire without the lock.
- **Event type `ADMISSION_CHOICES_FINALIZED`** — names what the moment means (programme choices final,
  application locked-forward). Payload: `{ caseId, applicationId, submittedAt, choiceCount, choices:
  [{ choiceId, programmeId, priority, intakeMonth, intakeYear }] }`.
- `EventsService` injected into `AdmissionService` (provided in `StudentsModule`, matching how
  `cases.module` provides it).

Note: staff choice-editing is deliberately *not* status-locked (`// NB: no status lock for staff`),
so the signal marks the **client's finality act**, not an immutable data lock. Submit is one-way
(`submitApplication` throws if not `DRAFT`), so the event fires exactly once per application.

## Verification (HTTP-level)
- Clean `nest build`; app boots, DI resolves; admission+staff+sla jest **131/131** (unchanged).
- **Authenticated HTTP e2e 8/8** through the *real* student submit endpoint (`POST
  /students/me/admission/application/submit`) with a genuine login token, satisfying the entire submit
  gauntlet (payment gate, ~15 required fields incl. an encrypted passport, NZ mandatory slot types
  pos4=ITP/pos5=PTE, required docs): submit → 201 SUBMITTED; **exactly one**
  `ADMISSION_CHOICES_FINALIZED` `CrmEvent` emitted; correct `entityType`/`leadId`/`SYSTEM` source;
  payload carries the 5 finalized choices; the audit log is present (atomic); re-submit → 409 with
  **no duplicate event**.

## Honest notes / follow-ups
- **Emit-only, by design.** No consumer reacts to the signal yet. When a real reaction is wanted
  (e.g. kick off CV/SOP generation automatically on finality instead of staff-triggered), a consumer
  reads `crm_events WHERE eventType = 'ADMISSION_CHOICES_FINALIZED' AND processingStatus = 'PENDING'`.
- **The finality moment is also where an outbox processor would naturally live** — none exists yet
  across the whole `crm_events` stream; that's a platform-level addition, not this slice.

## Where this sits — Admission Specialist portal complete
Step 1 (Case File) → 2a (employment) → 2b (AI CV) → 3 (AI SOP + gates) → 4 (Submission Log) →
5 (5-day follow-up) → 6 (Offer / Decline / Sequential) → **Step 7 (finality signal) ✓**.
