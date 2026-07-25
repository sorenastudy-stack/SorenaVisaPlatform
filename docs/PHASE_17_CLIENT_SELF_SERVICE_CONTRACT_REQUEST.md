# Phase 17 — Client Self-Service "Request Contract"

End-of-phase handover for a client-facing "Request my engagement contract" button.
Until now only staff (Client Officer / LIA) could trigger an engagement contract
send; a signed-in client can now trigger their OWN send from the portal. The whole
feature is a **thin new surface over the existing Phase A/B send engine** — the
Phase A gate, the DocuSeal dispatch, and the duplicate-send protection are all
reused verbatim, not re-implemented.

**Date:** 2026-07-25
**Commit (this phase):**
- `6cc8466` — feat(portal): client self-service "Request contract" (reuses Phase A/B send engine)

---

## 1. What this phase does

A client who has finished their free 15-minute consultation can now click **"Request
my engagement contract"** in the portal's "What to do next" list. That fires the
**exact same send** a Client Officer or LIA would fire — the engagement letter goes
out via DocuSeal to the client (first signer), then the LIA, then the Director — with
zero shortcuts around the rules built in Phase A/B.

Four moving parts, all deliberately small:

1. **New client endpoint** `POST /portal/me/contract/request` (roles `LEAD`/`STUDENT`),
   rate-limited, that resolves the caller's OWN case/lead and calls the staff send
   engine with the client marked as the actor.
2. **A client-safe error wrapper** around the Phase A gate rejection, so a locked
   state never shows a client the raw staff-facing message.
3. **A `REQUEST_CONTRACT` next-step** in `buildNextSteps`, shown only when the send
   would actually be allowed (so the button never renders in a locked state).
4. **A `RequestContractButton` UI component** with success + locked/error copy.

Everything security- and correctness-critical (the gate, the DocuSeal dispatch, the
duplicate-send guards) is **inherited from the existing engine**, not rebuilt.

## 2. Files created or changed

Pulled from `git show --stat 6cc8466` (6 files).

*Created*
- `backend/src/portal/portal-contract-request.spec.ts` — DB-backed spec (5 scenarios)
  exercising the REAL `ContractsService` + gate + DB unique index, stubbing only the
  DocuSeal network call.
- `frontend/src/components/portal/RequestContractButton.tsx` — the `'use client'`
  button (label + success/locked copy; `router.refresh()` on success so the
  next-steps re-render).

*Changed*
- `backend/src/portal/portal.service.ts` — new `requestOwnContract(userId, actorName,
  actorRole)`; a `REQUEST_CONTRACT` step added to `buildNextSteps` (with the
  `liaApproved` value now computed once and reused for both the LIA_REVIEW notice and
  the button's visibility). Imports `ContractsService` +
  `UnprocessableEntityException`.
- `backend/src/portal/portal.controller.ts` — `POST me/contract/request` route with
  `@Throttle({ default: { ttl: 60000, limit: 5 } })`.
- `backend/src/portal/portal.module.ts` — imports `ContractsModule` for its exported
  `ContractsService` (no DI cycle: nothing in the contracts graph imports
  `PortalModule`).
- `frontend/src/app/portal/case/page.tsx` — renders `<RequestContractButton />` for a
  `REQUEST_CONTRACT` step.

The whole server-side action, showing the reuse (no gate/dispatch logic here):

```ts
// portal.service.ts — requestOwnContract (abridged)
const ownCase = await this.prisma.case.findFirst({
  where: { lead: { contact: { userId } } }, orderBy: { createdAt: 'desc' }, select: { id: true },
});
const dto = ownCase ? { caseId: ownCase.id } : { leadId: (await resolveOwnLead()).id };
try {
  await this.contracts.createContractViaDocuseal(dto, { id: userId, name: actorName, role: actorRole });
  return { ok: true };
} catch (err) {
  if (err instanceof UnprocessableEntityException) {
    throw new UnprocessableEntityException(
      "We're not quite ready to send your contract yet — we'll be in touch shortly to let you know what's needed.",
    );
  }
  throw err; // "already sent" / "already has a case" pass through unchanged
}
```

## 3. Database tables / columns added

**None — no schema migration.** The feature reads existing tables (`Lead`, `Case`,
`Contract`, `Consultation`, `Contact`) and writes only what the existing send engine
already writes (a `Contract` + its `ContractSigner` rows + an audit row). The
duplicate-send backstop it relies on — the partial unique index
`contracts_leadId_active_key` and the `Contract.caseId` unique constraint — already
existed (Phase B, migration `20260723160000_contract_lead_based`).

## 4. Environment variables added (names only)

**None new.** The send path already requires `CONTRACT_DIRECTOR_EMAIL` and
`CONTRACT_DIRECTOR_NAME` (unchanged from Phase A/B) and honours `CONTRACT_PROVIDER`
(DocuSeal is the active default). This feature adds no variables of its own.

## 5. Third-party services connected

**None new.** The contract is dispatched through the existing DocuSeal integration
via the shared `ContractsService.createContractViaDocuseal`. The client path uses the
identical provider call as the staff path.

## 6. How to test it works

**Automated** — `portal-contract-request.spec.ts` (DB-backed, 5/5 green). It builds a
REAL `ContractsService` (real Prisma, real `LiaAssignmentService`, real gate, real DB
unique index) and stubs ONLY the DocuSeal network call, so the gate + idempotency are
genuinely under test:
1. Client with completed FREE_15 + no red flag → one DocuSeal submission, exactly one
   Contract persisted, audit attributed to the client role.
2. No FREE_15 → `REQUEST_CONTRACT` step absent (present once completed).
3. Red-flagged + not approved → `LIA_REVIEW` shown, button absent; direct endpoint hit
   → the calm client-safe message, DocuSeal never called; reappears once LIA approves.
4. Double-click (sequential AND 3-way concurrent) → still exactly one Contract.
5. Staff send path (Client Officer actor) unchanged — regression pass.

**Manual** (live client portal):
1. As a client with a completed FREE_15, no red flag, no contract yet → `/portal/case`
   shows **"Request my engagement contract"**. Click → toast *"Your engagement letter
   is on its way!…"*, the step flips to *"On its way"*, list refreshes, DocuSeal email
   arrives — identical to a staff-sent one.
2. Client without a completed FREE_15 → the button never appears.
3. Red-flagged, not yet LIA-approved → the calm *"Legal/immigration review needed — In
   review"* notice shows instead; POSTing the endpoint directly returns the client-safe
   locked message, never the raw staff wording. After an LIA records APPROVED, reload →
   the button appears.
4. Rapid double-click → only one contract/email is ever created.
5. Staff sends (Client Officer / LIA) work exactly as before.

## 7. Known limitations

- **Idempotency was deliberately NOT re-implemented.** `requestOwnContract` adds no
  "already sent" check of its own. It relies entirely on the pre-existing protections
  in the shared engine: `prepareEngagementSend`'s rejections ("This lead already has a
  case — send the contract from the case." / "A contract has already been sent for this
  lead." / "Contract already exists for this case"), backstopped at the database by the
  partial unique index `contracts_leadId_active_key` (one live lead-based contract per
  lead) and the `Contract.caseId` unique constraint. The spec proves this holds even
  under **concurrent** double-clicks (three simultaneous requests → exactly one
  Contract row). Re-implementing a client-side guard would have been a second, weaker
  copy of a rule the engine already enforces atomically — so we intentionally didn't.
- **The button is presentation-gated, but the endpoint is the real authority.** The
  `REQUEST_CONTRACT` step mirrors the Phase A gate so the button normally only renders
  when the send is allowed. The endpoint re-runs the true gate on submit, so a stale
  page / direct hit in a locked state is caught server-side and returns the calm
  message — the visibility rules are a UX nicety, not the security boundary.
- **`actorName` is usually null.** The JWT strategy returns `{ userId, email, role }`
  with no name, so a client-triggered send records `actorRoleSnapshot` = `LEAD`/
  `STUDENT` (which is what distinguishes it from a staff send) but a null actor name.
  This matches how the codebase already attributes client actions and is sufficient for
  the audit trail; wire a name through the JWT if a named client actor is ever wanted.
- **No client-facing "resend" / status polling.** Once requested, the client tracks
  progress through the existing next-steps ("check your email to sign" →
  "signed, wrapping up internally"). There is no separate "request status" surface;
  none was asked for.

## 8. How a future developer would extend this

**IMPORTANT — the case-first / lead-fallback correction (read before touching the
target resolution).** The original spec asked for `createContractViaDocuseal({ leadId },
actor)`. The implementation instead resolves **case-first, lead-fallback**, and this
deviation is deliberate and load-bearing:

- A **case is created eagerly** the moment a lead is marked `QUALIFIED`
  (`provisionStudentAccount` in `leads/leads.service.ts` creates the STUDENT account +
  a Case), which happens **before** any contract exists.
- The client portal's next-steps only render when a case exists (`getMyCase` throws
  404 otherwise), so **by the time the `REQUEST_CONTRACT` button is visible, a case
  almost always already exists.**
- The send engine **rejects a lead-based send for a lead that already has a case**
  (`"This lead already has a case — send the contract from the case."`). So targeting
  `leadId` only would have failed on the common path — the exact path the feature is
  for.
- Therefore `requestOwnContract` sends **`{ caseId }` when the client has a case**
  (the normal case) and falls back to **`{ leadId }`** only when no case exists yet
  (the pure lead-based / direct-hit edge). Both hit the identical Phase A gate. **Do
  not "simplify" this back to leadId-only** — it will break the feature for every
  QUALIFIED client.

Other extension points:
- **The Phase A gate is caller-agnostic** — `assertContractSendAllowed(lead)` keys on
  the lead, not the actor, so client and staff sends pass through the identical check.
  Change the gate in `contracts.service.ts` and both paths follow automatically.
- **Button visibility** lives in `buildNextSteps` (`portal.service.ts`): the
  `REQUEST_CONTRACT` push is guarded by `free15Complete && !contractExists && (!redFlagged
  || liaApproved)`. Adjust the predicate there; the endpoint's real gate is the
  backstop regardless.
- **Client-safe copy** for the locked state lives in one place (`requestOwnContract`'s
  catch) and the button's toast; the success/label strings are in
  `RequestContractButton.tsx`.

## 9. Security layers applied

- **Ownership is derived, never supplied.** The client sends no id; the target
  case/lead is resolved server-side from `lead.contact.userId` (the same no-leak
  posture as the invoice pay-link / receipt endpoints — anything not theirs → 404).
  A client physically cannot target another client's lead/case.
- **Role gate.** The route inherits the `PortalController` class guards
  (`JwtAuthGuard + RolesGuard + @Roles('LEAD','STUDENT')`); a staff token is 403'd, and
  the staff `POST /contracts` endpoint remains staff-only and untouched.
- **Rate limiting.** `@Throttle({ default: { ttl: 60000, limit: 5 } })` — 5/min/IP,
  matching the convention on other sensitive client-facing writes (auth, acquisition).
- **The real gate runs on submit.** `assertContractSendAllowed` (consultation-complete
  + red-flag/LIA-approval) executes inside the engine on every request, so button
  visibility can never be trusted as authorization — a race/direct-hit in a locked
  state is rejected and returns the client-safe message.
- **Duplicate sends are blocked atomically** at the DB (partial unique index +
  `caseId` unique), not by an app-level check that could race.
- **Audit attribution.** Every client-triggered send writes an audit row with
  `actorRoleSnapshot` = the client's role, so self-service sends are distinguishable
  from Client-Officer / LIA sends in the trail.

## 10. Rollback instructions

No schema migration, so rollback is a plain git revert:

1. **Revert the feature:** `git revert 6cc8466`. This removes the client endpoint, the
   `REQUEST_CONTRACT` next-step, the button, and the `ContractsModule` import in
   `PortalModule`. The staff send paths, the Phase A/B engine, and the DB unique indexes
   are all untouched (they predate this commit), so staff-initiated sends keep working
   unchanged.
2. **No data cleanup needed** — any contracts already requested by clients are ordinary
   engagement contracts, indistinguishable downstream from staff-sent ones (only the
   audit actor differs). They continue through the normal sign/countersign lifecycle.
3. **Partial revert (keep the endpoint, hide the button):** if you only want to pull the
   client-facing button but keep the API, remove the `REQUEST_CONTRACT` push in
   `buildNextSteps` and the `<RequestContractButton />` render — the endpoint stays live
   and gated for any future re-enable.
