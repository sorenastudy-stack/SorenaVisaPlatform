# PR-ADMISSION-OFFER — Step 6: Offer / Decline / Sequential Submission

**Status:** BUILT + VERIFIED (2026-08-03). Backend + Case File UI together. Depends on Step 4
(Submission Log) and its `OFFER`/`DECLINED` outcomes, and the canonical NZ working-days util (Step 5).

## Three pieces

### 1. Sequential submission (PRD_10 — "Slot 1 → Slot 2 after 21 working days, no parallel")
A pure, golden-frozen gate derived entirely from the ordered `AdmissionProgrammeChoice`s (Slot N =
priority N) + each choice's **latest** submission outcome + a 21-working-day timeout (via the shared
`addWorkingDays`). Owner decisions (2026-08-03), all as recommended:

- **Strict single-active (withdraw-then-advance).** A choice only *clears the way* for the next when
  it is `DECLINED` or `WITHDRAWN`. A slot pending ≥21 working days is `TIMED_OUT` — **still live
  (blocking)** — a prompt to withdraw and advance, never an auto-clear. So at most one application is
  ever live. `SubmissionService.create` is gated: submitting to Slot K is refused unless every
  earlier slot is cleared and no other slot is live (with a specific reason).
- **An OFFER halts the sequence.** Once any slot is `OFFERED`, all further submissions are blocked;
  declining the received offer (recording `DECLINED` on it) reopens progression.
- **Decline → next-slot activation is derived, not a separate action.** Recording
  `outcome = DECLINED` (reason in `responseNotes`) on Slot N's submission clears it, and the gate
  opens Slot N+1 automatically. **Withdraw = recording `WITHDRAWN`**; both already existed in Step 4.

`SubmissionService.list` now returns a `slot` block per choice (`state`, `isActiveSlot`, `canSubmit`,
`timedOut`, `blockedReason`) — the same logic the create-gate uses — so the UI locks non-active slots
and explains why without re-deriving anything.

### 2. Offer record (fills the `Award` placeholder)
A new **`OfferRecord`** model (additive migration `20260803160000`) per programme choice: `offerType`
(CONDITIONAL/UNCONDITIONAL), `conditions`, `offeredAt`/`expiresAt` dates, `letterFileName`/`Url`
(upload wiring deferred), `notes`, and the client's `decision` (PENDING/ACCEPTED/DECLINED). CRUD via
`OfferService` + `/staff/cases/:caseId/offers` (curator roles), gated to `SUBMITTED`. Light validation
(valid offer type; dates valid; expiry not before offer date).

### 3. Decline
Kept as the existing `SubmissionRecord.outcome = DECLINED` (+ reason in `responseNotes`) — no separate
model. A *declined application* clears the slot (→ next slot); a *declined offer* is
`OfferRecord.decision = DECLINED` (reopens the sequence).

## UI (Case File Admissions tab)
- **Submission log** gains sequential awareness: an "Active slot" badge, the "Log submission" button
  **disabled on non-active slots** with the `blockedReason` shown, and a timed-out prompt ("pending 21
  working days — record Withdrawn to advance").
- **Offer record** section (replaces the placeholder): per choice, create/edit the offer detail
  (type/conditions/dates/notes), quick **Accept / Decline offer** actions, and delete. Colour-coded
  type + decision badges.

## Verification (HTTP-level, per the Step-5 standard)
- Golden **13/13** (`sequential.logic`): slot-state mapping incl. the 21-wd timeout, the full gate
  (submit-in-order, no-parallel, decline→advance, timeout-still-blocks, offer-halts, exhausted),
  active-slot pointer, order-independence.
- Admission + staff + sla jest **131/131**; clean `nest build`; app boots, 4 offer routes mapped, DI
  resolves. Frontend `tsc` clean + `next build` OK.
- **Authenticated HTTP e2e 14/14** through the live stack (real `/auth/login` token) — the exact
  endpoints the UI calls: Slot-2-first blocked; Slot 1 allowed; Slot 2 blocked while Slot 1 live;
  list slot status correct; after Slot 1 `DECLINED`, Slot 2 opens; Slot 2 `OFFER` halts the sequence;
  offer create (conditional) → list → decision `ACCEPTED` → expiry-before-offer rejected → delete.

## Honest notes / follow-ups
- **21 working days is a constant** (`SEQUENTIAL_ADVANCE_WORKING_DAYS`), matching the 5-day follow-up's
  approach; a per-country config knob is a clean later addition (alongside `slotCount`).
- **Timeout is a prompt, not an auto-advance** — by the strict-single-active decision, staff must
  record `WITHDRAWN` to move on. A daily "slot timed out — advance" task (reusing the follow-up sweep)
  is an optional future nicety; today it's a derived UI flag.
- **Offer-letter upload** — `letterFileName/Url` columns exist; the actual file upload (R2/multer,
  like other admission docs) is a later slice.

## Where this sits
Step 1 → 2a → 2b → 3 → Step 4 (Submission Log) → Step 5 (5-day follow-up) →
**Step 6 (Offer / Decline / Sequential Submission) ✓** → Step 7 (finality signal) → catch-ups.
