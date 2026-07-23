# Phase 13 — Lead-Based Contracts & Auto-Case-Creation (Phase B)

End-of-phase handover for moving engagement-contract sending from **Case-based** to
**Lead-based**, with the Case auto-created the instant the Client finishes their own
signature. This is **Phase B** of the contract redesign that began with Phase A
(the consultation + red-flag send gate, see PHASE_12). Built, tested, migrated to
production, and the UI entry point wired.

**Date:** 2026-07-23
**Commits (this phase):**
- `6f34800` — feat(contracts): Phase B — lead-based contract sending + case auto-creation on client-sign
- `f536632` — feat(leads): lead-based "Send contract" entry point on the lead detail page (Phase B UI)

---

## 1. What this phase does

Previously an engagement contract could only be sent from an existing **Case**, and
a Case had to be created manually (staff "Create case") *before* the contract went
out. Phase B inverts that:

- A contract can now be sent **directly from a Lead** — no Case needed yet
  (`POST /contracts { leadId }`).
- The **Case is auto-created the moment the CLIENT (first signer) completes their
  signature** — *before* the LIA and Director countersign. At that instant the
  webhook creates the Case and backfills `Contract.caseId`.
- The **$200 engagement invoice and the LEAD→STUDENT promotion are UNCHANGED** —
  they still fire only at **full completion** (all three parties signed). Their
  call site inside the `allCompleted` branch is what keeps them there; a boxed
  "DO NOT MOVE" comment guards it.
- A **staff "Send contract" entry point** was added to the Lead detail page,
  reusing the existing case-detail `SendContractPanel` in a new lead mode.

The legacy **Case-based** send flow (send from the Case page) is retained and works
exactly as before — every existing signed/pending contract is untouched.

## 2. Files created or changed

Pulled from `git show --stat 6f34800` and `git show --stat f536632`.

**Backend — `6f34800`**

*Created*
- `backend/prisma/migrations/20260723160000_contract_lead_based/migration.sql` —
  the schema change (see §3).
- `backend/src/contracts/contracts.phase-b.spec.ts` — DB-backed integration spec
  (4 scenarios: lead-based send + case auto-creation, retry idempotency, invoice
  timing at full completion, red-flag approval flow, case-based unaffected).
- `backend/src/portal/portal.phase-b-notice.spec.ts` — the half-signed portal
  next-step message spec.

*Changed*
- `backend/prisma/schema.prisma` — `Contract.caseId` nullable + new nullable
  `Contract.leadId` (+ relation, `@@index`), `Lead.contracts` back-relation.
- `backend/src/contracts/contracts.service.ts` — the largest change:
  `prepareEngagementSend` now resolves from **either** a `caseId` (legacy) or a
  `leadId` (Phase B); `createContract` / `createContractViaDocuseal` accept the
  resolved target and persist `caseId` **or** `leadId`; the DocuSeal webhook's
  client-signed (partial) branch **auto-creates the Case + backfills `caseId`** via
  the new idempotent `ensureCaseForLeadBasedContract`; the `allCompleted` downstream
  now uses a resolved (non-null) `caseId` and carries the **DO NOT MOVE** guard over
  the invoice/promotion calls.
- `backend/src/cases/lia-assignment.service.ts` — new **`pickLeastLoadedLia()`**:
  picks the least-loaded active LIA **without** a case write (the lead-based send
  has no case yet to assign to; the LIA becomes the contract's signer and the case
  is pointed at them on creation).
- `backend/src/staff/bookings/staff-bookings.service.ts` — `recordLiaDecision` now
  wraps the verdict + the **lead execution-gate clear** in one transaction (see §7a).
- `backend/src/contracts/dto/create-contract.dto.ts` — `CreateContractDto` accepts
  `leadId | caseId` (both optional; service enforces exactly-one).
- `backend/src/portal/portal.service.ts` — `buildNextSteps` checks the client's
  **own** signer row: before signing → "Sign your engagement letter"; after signing
  but not yet fully SIGNED → the calm `CONTRACT_PENDING_COUNTERSIGN` message.
- `frontend/src/app/portal/case/page.tsx` — renders the new
  `CONTRACT_PENDING_COUNTERSIGN` next-step kind.
- Test wiring updated for the new `CasesService` dependency:
  `contracts.docuseal-webhook.spec.ts`, `contracts.gate.spec.ts`,
  `contracts.service.spec.ts`.

**Frontend + role change — `f536632`**
- `frontend/src/components/staff/cases/detail/SendContractPanel.tsx` — generalized
  to accept **either** `caseId` (case-based, behaviour byte-identical) **or**
  `leadId` + `leadCaseId` (lead-based). Lead mode skips the GET-by-case existence
  check, `POST /contracts { leadId }`, and links to the case once it exists.
- `frontend/src/app/staff/leads/[id]/page.tsx` — renders `SendContractPanel` in
  lead mode under the Create-case card, for leads with no case yet.
- `backend/src/contracts/contracts.controller.ts` — widened `POST` + `GET
  /contracts` `@Roles` to include **`CLIENT_CONSULTANT`** (Client Officer) so they
  can originate lead-based sends (see §9).

The gate on the single shared send-prep (unchanged Phase A gate, now lead-keyed):

```ts
// prepareEngagementSend resolves the lead from caseId OR leadId, then:
await this.assertContractSendAllowed({ id: resolvedLeadId, liaEscalationRequired });
```

## 3. Database tables / columns added

- **`Contract.caseId` is now nullable** (`String?`). It stays `@unique` (a case can
  still only have one contract; Postgres allows the many NULLs of the lead-based
  window). Existing rows all have `caseId` set → unaffected.
- **`Contract.leadId String?`** (+ FK to `Lead`, `ON DELETE SET NULL`) — set on a
  lead-based send; legacy case-based rows leave it NULL and resolve the lead via the
  case. Indexed (`contracts_leadId_idx`).
- **Partial unique index `contracts_leadId_active_key`** — `UNIQUE (leadId) WHERE
  "caseId" IS NULL`. Enforces **one LIVE lead-based contract per lead** during the
  pre-case window; once `caseId` is backfilled the row leaves the index. (Partial
  indexes aren't expressible in the Prisma schema, so this lives only in the
  migration — do not expect `prisma db pull` to reproduce it.)
- **Migration:** `20260723160000_contract_lead_based` (2026-07-23). Applied to
  production via `prisma migrate deploy`. Verified post-deploy: `caseId`/`leadId`
  both nullable, both indexes present, and **all pre-existing contracts still carry
  their `caseId` with 0 `leadId`** — no live signed/pending contract changed.

```sql
ALTER TABLE "contracts" ALTER COLUMN "caseId" DROP NOT NULL;
ALTER TABLE "contracts" ADD COLUMN "leadId" TEXT;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "contracts_leadId_idx" ON "contracts"("leadId");
CREATE UNIQUE INDEX "contracts_leadId_active_key" ON "contracts"("leadId") WHERE "caseId" IS NULL;
```

**Backup taken first** (standing rule for money/data-touching migrations): the
`contracts` (4 rows) and `leads` (41 rows) tables were dumped to CSV before the prod
migration ran.

## 4. Environment variables added (names only)

**None.** Phase B introduced no new configuration. It reuses the existing DocuSeal
env (`CONTRACT_PROVIDER`, `DOCUSEAL_*`, `CONTRACT_DIRECTOR_EMAIL/NAME`) and the
existing engagement-fee env (`ENGAGEMENT_FEE_CENTS` / `ENGAGEMENT_FEE_CURRENCY`).

## 5. Third-party services connected

**None new.** This builds entirely on the **existing DocuSeal webhook** from
Phase 9. The only new behaviour is what the webhook *does* on the per-submitter
(`form.completed`) client-signed event — it now auto-creates the Case. No new
account, key, or integration.

## 6. How to test it works

**A. Lead-based send + auto-case (happy path)**
1. As OWNER / SUPER_ADMIN / ADMIN / LIA / Client Officer, open a lead
   (`/staff/leads/<id>`) that has a **COMPLETED FREE_15** consultation, is **not
   red-flagged**, and has **no case** yet.
2. Under "Case", the **Engagement contract** card → **Send contract**. Click it →
   success toast; the client is emailed by DocuSeal.
3. Have the **client sign** (first signer). Confirm in the DB that a **Case now
   exists** for the lead and **`Contract.caseId` is backfilled** — *before* the LIA
   and Director have signed. The lead page now shows "A case has opened…" + View case.

**B. Retry idempotency**
- Re-deliver the same client-signed webhook (or reload) → still exactly **one** case,
  no error.

**C. Money gate — invoice + promotion only at full completion (highest-risk)**
- After **client-only** signing: confirm **no** `ENG-<caseId>` invoice exists and the
  client is still a `LEAD`.
- After the **LIA + Director** also sign (submission.completed): confirm the contract
  is `SIGNED`, the **$200 invoice** now exists, and the client is promoted to
  `STUDENT`. The invoice `createdAt` is at the final signature, not the first.

**D. Red-flagged lead needs LIA approval first**
- On a red-flagged (HS4) lead, **Send contract** → toast: *"This case has a flagged
  immigration/legal concern… locked until an LIA … approves."* As the LIA, record
  **APPROVED** on the LIA consultation → the lead's execution gate clears → **Send
  contract** now succeeds → case auto-creates on client sign.

**E. Case-based unaffected (regression)**
- On an existing case with no contract (`/staff/cases/<id>`), the same panel sends
  via `POST { caseId }` and shows `Contract: SENT` — identical to before.

**Automated checks already green:** `contracts.phase-b.spec` (A–E, incl. the
invoice-timing regression + retry idempotency) and `portal.phase-b-notice.spec` all
pass; existing contract/gate/webhook suites updated for the new dependency and green.

## 7. Known limitations

- **(a) Gate-reconciliation — LIA approval now also clears the Lead's execution
  gate.** When an LIA records **APPROVED** on an LIA consultation, the same
  transaction sets `Lead.executionAllowed = true` and clears `hardStopFlag` /
  `liaEscalationRequired`. **Why this was necessary:** an HS4 red-flagged lead has
  `executionAllowed=false` + `hardStopFlag=true` (HS4 fails scoring Gate 4 and Gate
  5). Phase A lets such a lead's contract be *sent* after LIA approval — but that
  approval was recorded on the **Consultation**, not the Lead. When the client then
  signs and the webhook calls `CasesService.createCase`, `createCase` enforces the
  **stricter** gate (`!executionAllowed || hardStopFlag`) and would **reject** the
  exact leads Phase A admitted, leaving a fully client-signed contract with no case.
  Reconciling the two gates at the LIA-approval step is what makes the auto-create
  succeed. (This is the "lead-level equivalent of `clearHardStop`", but run before
  any case exists.)
- **(b) Lead-mode "sent, awaiting signature" UI does not survive a reload.** There is
  no GET-by-lead contract endpoint, so the "already sent" state is only tracked in
  session. After a full page reload of a lead whose contract was sent but not yet
  signed, the **Send contract** button reappears. This is **safe** — clicking it is
  rejected by the backend with *"A contract has already been sent for this lead."*
  (the partial unique index is the hard backstop). Cosmetic only.
- **(c) Phase C is NOT built.** The restricted-vs-full-access gate tied to the **200
  NZD engagement payment** is the next phase — designed, not implemented.
- **(d) No client self-service "request contract" button.** Sending is staff-initiated
  only; a client-facing request flow remains a separate, later backlog item.

## 8. How a future developer would extend this

- **The client-signed webhook branch** lives in
  `ContractsService.handleDocusealWebhook` (`backend/src/contracts/contracts.service.ts`),
  in the `if (!allCompleted)` block — it detects the CLIENT/GUARDIAN signer's
  `signedAt` and calls `ensureCaseForLeadBasedContract(contractId, leadId)` (the
  idempotent create-or-find-then-backfill helper, defined just below `handleDocusealWebhook`).
- **The "DO NOT MOVE" guard** is the boxed comment immediately above the
  `maybePromoteClientToStudent` / `maybeCreateEngagementInvoice` calls in the
  `allCompleted` branch. Those two methods' *internal* triggers fire on "client
  signed" — only the call site keeps them at full completion. Never move them into
  the client-signed branch or the $200 fires early.
- **Fixing the reload-persistence gap (§7b)** would be a small read-only addition:
  either a `GET /contracts/lead/:leadId/status` endpoint, or surface the lead's live
  contract status in the `/staff/leads/:id` response, then drive the lead-mode panel
  state from it instead of the in-session flag. No gate/webhook change needed.
- **Contract creation targets** are resolved in `prepareEngagementSend` (the single
  shared prep for both providers) — it returns `resolved: { caseId, leadId }` that
  the two `createContract*` methods persist. The Phase A gate
  (`assertContractSendAllowed`) is called there and is lead-keyed, so any new send
  path passes it automatically.
- **LIA selection without a case:** `LiaAssignmentService.pickLeastLoadedLia()`.

## 9. Security layers applied

- **`CLIENT_CONSULTANT` (Client Officer) role widening — deliberate.** `POST` and
  `GET /contracts` were `@Roles('OWNER','SUPER_ADMIN','ADMIN','LIA')`; per the
  product decision this phase, `CLIENT_CONSULTANT` was **added** so Client Officers
  can originate lead-based sends (and read the case-side status). This widens the
  shared endpoint's authorization by exactly one legitimate role; the front-end
  panel's role list mirrors it (UX-only — the backend `@Roles` is the real boundary).
- **Phase A's gate is untouched.** `assertContractSendAllowed` (consultation
  completion + red-flag/LIA-approval) still runs on the single shared send-prep and
  is enforced identically for lead-based and case-based sends — no caller bypasses it.
- **One-live-contract-per-lead is enforced at the DB layer** (the partial unique
  index), not just the app pre-check, so a race can't create two lead-based contracts.
- **The gate-reconciliation clear is transactional + audited** — the verdict, the
  lead-flag clear, and a `LIA_LEAD_GATE_CLEARED` audit row are written in one
  transaction, so an APPROVED verdict can never leave the lead half-cleared.
- **The webhook stays fail-safe:** a `createCase` failure (e.g. a lead that still
  isn't execution-eligible) is logged loudly and returns null rather than crashing
  the webhook into a DocuSeal retry storm; the contract stays lead-based for manual
  attention, and no money side-effects fire.

## 10. Rollback instructions

The migration is **additive / constraint-relaxing**, and **existing case-based
contracts were never touched** (they keep their non-null `caseId`, null `leadId`).
A rollback therefore only needs to consider **new lead-based sends**.

1. **Revert the code:** `git revert f536632 6f34800`. This restores case-based-only
   sending (the send-prep requires a `caseId` again), removes the lead-page send
   entry point, removes the client-signed auto-create branch, reverts the portal
   half-signed message, and reverts the `CLIENT_CONSULTANT` role widening + the
   gate-reconciliation clear.
2. **Leave the schema in place.** `Contract.caseId` (nullable), `Contract.leadId`,
   and the two lead indexes are harmless to the reverted case-based code (which only
   ever writes `caseId`). Do **not** drop them without first checking for any
   lead-based contract rows (`caseId IS NULL AND leadId IS NOT NULL`) — those would
   be **in-flight lead-based sends** (client hasn't signed yet). Any such row needs
   manual attention after a revert: either let it complete under the pre-revert code
   first, or create its case manually and backfill `caseId`.
3. **What a rollback does NOT affect:** every contract already tied to a case
   (all legacy rows, plus any lead-based contract whose client already signed — its
   `caseId` is backfilled) keeps its status, signed PDF, captured visaType, invoice,
   and promotion. The DocuSeal webhook's `allCompleted` (full-signature) path is
   unchanged by Phase B, so completed contracts are safe either way.
4. No env-var or third-party rollback is needed.
