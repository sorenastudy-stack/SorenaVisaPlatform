# Phase 12 — Contract-Send Gate (Consultation + Red-Flag / LIA Gate)

End-of-phase handover for gating engagement-contract sending behind consultation
completion, with a hard lock for immigration/legal red-flagged leads until a
licensed adviser approves. Built, tested, migrated to production.

> **This is Phase A of a larger planned redesign.** Phase B (auto-case-creation on
> contract signing; moving contract-send to be Lead-based instead of Case-based) and
> Phase C (restricted-vs-full-access gate tied to the 200 NZD payment) are **designed
> but NOT yet built** — see §7.

**Date:** 2026-07-23
**Commits (this phase):**
- `2eee633` — feat(contracts): Phase A — gate contract sending behind consultation completion
- `3731163` — test(contracts): fix ContractsService webhook spec DI to match current constructor

---

## 1. What this phase does

Before an engagement contract can be created/sent for a lead's case, the send now
passes a single precondition gate (`assertContractSendAllowed`), enforced on the one
shared send path (`prepareEngagementSend`) so it covers **both** providers (DocuSign
+ DocuSeal) and **every** caller (Client Officer, Owner, Admin, LIA) — no role
bypasses it:

1. **Free consultation must be done.** A `FREE_15` consultation for the lead must be
   `COMPLETED`, else the send is blocked: *"This client hasn't completed their free
   15-minute consultation yet."*
2. **Red-flag lock.** If the lead is flagged for immigration/legal review
   (`Lead.liaEscalationRequired`, set from the HS4 hard-stop in scoring), the send is
   **additionally** blocked until an `LIA`-type consultation is `COMPLETED` with a
   recorded verdict of **APPROVED**. A missing verdict, or `NEEDS_MORE_INFO` /
   `REJECTED` / `WITHDRAWN`, keeps it locked with a state-specific message. A
   non-flagged lead is unaffected by any voluntarily-booked LIA session.

Supporting pieces: the LIA records their verdict via a new endpoint + a "Legal review
verdict" action in the staff My Meetings popover (reusing the existing `LegalDecision`
vocabulary), and the client portal shows a **calm** "Legal/immigration review needed"
next-step while a flagged case waits — which clears the moment an LIA approves. When
approved, the LIA can send the contract through the **existing** SendContractPanel
(already role-permitted); no new send UI was needed.

## 2. Files created or changed

Pulled from `git diff --stat 11f1d84..3731163`. **12 files, +565 / −23.**

**Created**
- `backend/src/contracts/contracts.gate.spec.ts` — unit spec for
  `assertContractSendAllowed` (mocked Prisma): the FREE_15 rule, the HS4/LIA lock,
  APPROVED unlock, and each non-approve verdict's lock message. `2eee633`.
- `backend/src/portal/portal.lia-notice.spec.ts` — unit spec that the portal
  `LIA_REVIEW` next-step appears for a flagged-unresolved case and disappears once an
  LIA approves. `2eee633`.
- `backend/prisma/migrations/20260723140000_add_consultation_decision/migration.sql`
  — the `Consultation` verdict columns. `2eee633`.

**Changed**
- `backend/prisma/schema.prisma` — added `decision LegalDecision?`, `decisionNotes
  String?`, `decidedAt DateTime?`, `decidedById String?` to `Consultation` (reuses the
  existing `LegalDecision` enum; no new enum, no relation). `2eee633`.
- `backend/src/contracts/contracts.service.ts` — added the private
  `assertContractSendAllowed(lead)` and its call inside `prepareEngagementSend` (after
  the client-identity check, before LIA auto-assign). Purely additive — the DocuSeal
  webhook and signed/invoice/promotion logic are untouched. `2eee633`.
- `backend/src/staff/bookings/dto/staff-bookings.dto.ts` — added `RecordLiaDecisionDto`
  (`decision` enum + optional `notes`). `2eee633`.
- `backend/src/staff/bookings/staff-bookings.controller.ts` — added
  `POST /staff/consultations/:id/decision`, gated to `OWNER/SUPER_ADMIN/ADMIN/LIA`. `2eee633`.
- `backend/src/staff/bookings/staff-bookings.service.ts` — added `recordLiaDecision`
  (LIA-type + assigned-LIA-or-admin enforced; auto-completes the session; writes an
  `AuditLog`) and returns `decision` in the `/staff/bookings` list. `2eee633`.
- `backend/src/portal/portal.service.ts` — `buildNextSteps` now emits an `LIA_REVIEW`
  step when the case's lead is flagged and not yet APPROVED. `2eee633`.
- `frontend/src/app/portal/case/page.tsx` — renders the `LIA_REVIEW` step as a calm
  "In review" info row (not a to-do). `2eee633`.
- `frontend/src/components/staff/meetings/StaffMeetingsClient.tsx` — added the
  "Legal review verdict" panel (Approve / Needs info / Decline / Withdraw + notes) on
  actionable LIA sessions, posting to the decision endpoint. `2eee633`.
- `backend/src/contracts/contracts.service.spec.ts` — **test-only DI fix** (see note
  below): updated the test-module provider list to the current constructor
  (`MailService` / `R2Service` / `DocusealService` instead of the removed
  `NotificationsService`). `3731163`.

The gate (the single precondition), enforced for every provider + caller:

```ts
// Inside prepareEngagementSend, after client-identity validation:
await this.assertContractSendAllowed({
  id: caseRecord.lead!.id,
  liaEscalationRequired: caseRecord.lead!.liaEscalationRequired,
});
```

> **Note on `3731163`:** while running the suite to verify Phase A, the pre-existing
> `contracts.service.spec.ts` (the DocuSign webhook spec) was found broken — the
> DocuSeal migration had changed the `ContractsService` constructor
> (`NotificationsService` → `MailService`/`R2Service`/`DocusealService`) but never
> updated the spec's providers, so DI failed for all 4 tests. This commit is a
> **test-file-only** fix (the service was not changed); all 4 tests pass after it.

## 3. Database tables / columns added

- **`Consultation.decision LegalDecision?`**, **`decisionNotes String?`**,
  **`decidedAt DateTime?`**, **`decidedById String?`** — the LIA's verdict on an
  LIA-type consultation. All additive + nullable; reuses the existing `LegalDecision`
  enum (`APPROVED | REJECTED | NEEDS_MORE_INFO | WITHDRAWN`); no relation/FK added
  (`decidedById` is a plain id column). No existing `Consultation` usage changes.
- **Migration:** `20260723140000_add_consultation_decision` (2026-07-23). Applied to
  production via `prisma migrate deploy`.

```sql
ALTER TABLE "consultations" ADD COLUMN "decision" "LegalDecision";
ALTER TABLE "consultations" ADD COLUMN "decisionNotes" TEXT;
ALTER TABLE "consultations" ADD COLUMN "decidedAt" TIMESTAMP(3);
ALTER TABLE "consultations" ADD COLUMN "decidedById" TEXT;
```

## 4. Environment variables added (names only)

**None.** The gate reads only existing data (`Consultation`, `Lead.liaEscalationRequired`).
No configuration or feature flag was introduced — the gate is always on.

## 5. Third-party services connected

**None.** This phase is entirely internal (DB + existing contract-send flow). It reuses
the existing DocuSeal contract provider from Phase 9 unchanged; it does not add or
alter any external integration.

## 6. How to test it works

**Scenario 1 — clean send (regression):** a lead with **no** red flag and a
`COMPLETED` `FREE_15` → contract sends normally through the SendContractPanel.

**Scenario 2 — no free consult:** a lead with no `COMPLETED` `FREE_15` → send is
blocked with *"This client hasn't completed their free 15-minute consultation yet."*

**Scenario 3 — red-flagged, not yet approved:** a lead with `liaEscalationRequired =
true` and a `COMPLETED` `FREE_15` but no LIA verdict → send stays blocked with the
flagged-concern message, even for an Owner/Admin.

**Scenario 4 — approval unlocks:**
1. As the assigned LIA, open **My Meetings** → the flagged lead's LIA session →
   **Legal review verdict** → **Approve** (optionally add notes).
2. Retry the send — it now succeeds; the LIA can send via the SendContractPanel.
3. Also confirm `NEEDS_MORE_INFO` / `Decline` / `Withdraw` each keep it locked with
   their own message.

**Scenario 5 — portal notice:** for a flagged, unresolved case, the client portal
(`/portal/case`) shows a calm **"Legal/immigration review needed"** next-step ("In
review"); after the LIA approves, the notice disappears.

**Scenario 6 — nothing else changed:** confirm the DocuSeal webhook + downstream
(SIGNED, engagement invoice, LEAD→STUDENT promotion) are untouched — the
`contracts.service.ts` diff is additions only.

**Automated checks already green:** `contracts.gate.spec` (scenarios 1–4, incl. each
verdict message) and `portal.lia-notice.spec` (scenario 5) — **12/12 pass**. The
previously-broken `contracts.service.spec` (DocuSign webhook) passes after `3731163`.

## 7. Known limitations

- **This is Phase A of a larger redesign — Phase B and Phase C are designed but NOT
  built:**
  - **Phase B — auto-case-creation + Lead-based contract-send.** The plan is to
    create the case automatically when the contract is *signed*, and to move the
    contract-send trigger to be **Lead-based** rather than **Case-based** (today a
    case must exist before a contract can be sent). Designed, not implemented.
  - **Phase C — restricted-vs-full-access gate on the 200 NZD payment.** The plan is
    to gate restricted vs. full platform access on the 200 NZD engagement payment.
    Designed, not implemented.
  Until Phase B lands, the gate still operates on the existing **Case**-based
  contract-send flow.
- **DocuSeal "Passport Photo" upload field is a template (admin-UI) change, NOT code.**
  A Passport Photo upload field was added to the DocuSeal engagement template through
  the **DocuSeal admin console**, not in this repository. A future developer will not
  find it in the codebase — it lives in the DocuSeal template definition. If the
  template is recreated/migrated, that field must be re-added in the DocuSeal UI.
- **Verdict is per-consultation, latest-wins.** The gate reads the most recent
  `COMPLETED` LIA consultation with a non-null `decision`; re-recording updates it. A
  case with multiple LIA sessions is governed by the latest recorded verdict.
- **The gate does not itself notify anyone** when a case is red-flag-locked — the
  client sees the portal notice, but staff learn of the lock only when a send is
  attempted (and via the LIA's My Meetings view). No proactive staff alert yet.

## 8. How a future developer would extend this

- **Change the gate rules/messages:** `assertContractSendAllowed` in
  `backend/src/contracts/contracts.service.ts` — it's the single choke-point on
  `prepareEngagementSend`, so any change applies to all providers/callers at once.
- **Add a verdict type or change semantics:** the verdict reuses the `LegalDecision`
  enum; the recording logic is `StaffBookingsService.recordLiaDecision` and the route
  is `POST /staff/consultations/:id/decision` (DTO: `RecordLiaDecisionDto`).
- **Change the portal notice copy/logic:** `buildNextSteps` in
  `backend/src/portal/portal.service.ts` (`LIA_REVIEW` kind) and its render in
  `frontend/src/app/portal/case/page.tsx`.
- **Implement Phase B (Lead-based send + auto-case-on-sign):** the send-prep is
  `prepareEngagementSend`; moving it to Lead scope means loosening its case lookup and
  creating the case on the SIGNED webhook path in `handleDocusealWebhook`
  (`contracts.service.ts`). The gate itself already keys on the **lead**
  (`assertContractSendAllowed(lead)`), so it is Phase-B-ready.

## 9. Security layers applied

- **Single choke-point, no bypass.** The gate lives on `prepareEngagementSend`, the
  shared prep for both provider send paths, so no caller and no future entry point can
  send a contract without passing it. It runs **before** any assignment/dispatch.
- **Verdict recording is role- and ownership-gated.** `POST
  /staff/consultations/:id/decision` is restricted to `OWNER/SUPER_ADMIN/ADMIN/LIA`
  (consultants excluded), and the service additionally enforces that the caller is the
  **assigned LIA or an admin**, and that the consultation is LIA-type and not
  cancelled/no-show.
- **Audit trail.** Every recorded verdict writes an `AuditLog`
  (`action: 'LIA_CONSULTATION_DECISION'`, entity `Consultation`, with the lead id +
  decision) so who-approved-what is traceable.
- **Client-safe messaging.** The portal notice is deliberately vague and reassuring;
  it never surfaces the internal HS4 / hard-stop reasoning. The block messages shown
  to staff are precondition prompts, not internal scoring detail.
- **Additive + reversible schema.** The verdict columns are nullable with no FK, so the
  change can't break existing `Consultation` reads/writes.

## 10. Rollback instructions

The migration is **additive and nullable**, so rollback is code-only:

1. **Revert the gate:** `git revert 2eee633`. Contract sending returns to its
   pre-gate behaviour (no consultation/LIA precondition); the portal `LIA_REVIEW`
   notice and the decision endpoint/UI go away with it. The verdict columns remain
   (harmless, unused).
2. **Keep `3731163`** — it is an unrelated **test-only** fix for the DocuSign webhook
   spec's DI and should be retained regardless (reverting it re-breaks that suite).
3. **Leave the schema in place.** `Consultation.decision/decisionNotes/decidedAt/
   decidedById` are nullable and unreferenced once the gate is reverted; do not drop
   them unless a full teardown is intended (and only after confirming nothing reads
   them).

No env-var or third-party rollback is needed. **Note:** the DocuSeal "Passport Photo"
template field is an admin-UI change and is unaffected by any code rollback — remove
it in the DocuSeal console if it needs to be undone.
