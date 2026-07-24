# Phase 14 — Payment-Gated Access (Phase C)

End-of-phase handover for the payment-gated access system: full portal access
(Documents / Visa / Admission) stays locked until the $200 engagement fee is
paid, the fee is now raised the moment the LIA countersigns, and the payment
pathways (Stripe / bank transfer / money exchange) resolve to the correct
auto-unlock vs Finance-confirm behaviour. This is **Phase C** — the final phase
of the lead → case → payment redesign (Phases A, B, C). Built, tested, and shipped.

**Date:** 2026-07-24
**Commit (this phase):**
- `4613e0d` — feat(access-gate): Phase C — LIA-signed trigger timing, Client-Officer button gate, admin-configurable bank details

---

## 1. What this phase does

Three changes, all sitting on top of the engagement-payment gate that already
existed (the "Piece #4" gate: nav lock icons + the server-side `EngagementPaidGuard`
/ documents access check, all keyed on the `ENG-<caseId>` invoice being `PAID`):

1. **The $200 USD engagement invoice + the LEAD→STUDENT promotion now fire the
   moment the LIA countersigns** (the client has necessarily already signed) —
   they no longer wait for the Director's final countersignature. The Director's
   signature is purely the company's own record-keeping countersignature and
   unlocks nothing new. So a client becomes a STUDENT and receives their fee
   invoice as soon as the LIA signs.
2. **Full portal access stays locked until that invoice is actually `PAID`** —
   *instantly* for a direct Stripe card payment (the webhook reconciles the
   invoice), or *after Finance/Accountant confirmation* for a bank transfer or
   money-exchange receipt (the pre-existing receipt-upload → confirm flow). The
   gate itself was already correct (`invoice.status === 'PAID'`); Phase C only
   changed *when* the invoice is raised, not how it unlocks.
3. **Client Officers can no longer see the payment-link / manual-payment buttons**
   in the case Payments tab (they were already blocked server-side), and the
   **company bank-transfer details are now admin-editable** (Platform Settings)
   instead of hardcoded in the client pay screen.

## 2. Files created or changed

Pulled from `git show --stat 4613e0d`. **14 files, +582 / −69.**

**Piece 1 — trigger timing**
- `backend/src/contracts/contracts.service.ts` — in `handleDocusealWebhook`, the
  per-submitter partial branch now reads which parties have signed and, when the
  **LIA** has signed (client already has), calls `maybePromoteClientToStudent` +
  `maybeCreateEngagementInvoice` there. The old "DO NOT MOVE THESE TWO CALLS"
  comment on the `allCompleted` branch is replaced with one documenting the new
  timing; those two calls **remain** in `allCompleted` as an idempotent safety net
  for a coalesced `submission.completed` (first webhook = all three signed). No
  change to the helpers' internal logic — they were already guarded + idempotent.
- `backend/src/contracts/contracts.phase-c.spec.ts` — **new** DB-backed spec:
  Client → LIA → Director timing, retry idempotency, and the coalesced safety net.

**Piece 2 — Client-Officer UI gate**
- `frontend/src/components/cases/CasePaymentsPanel.tsx` — new `CREATE_PAYMENT_ROLES`
  set (mirrors the backend `@Roles`), used to hide the Create-link / Custom-link /
  Record-manual buttons for excluded roles (notably `CLIENT_CONSULTANT`).

**Piece 3 — admin-configurable bank details**
- `backend/src/platform-settings/platform-settings.service.ts` — `BANK_KEYS` +
  `getBankDetails()` (batch read with hardcoded-value fallbacks) + `updateBankDetails()`
  (upsert all five keys, audited `BANK_DETAILS_UPDATED`).
- `backend/src/platform-settings/platform-settings.controller.ts` — `GET` + `PATCH
  /staff/platform-settings/bank-details` (Owner/SuperAdmin/Admin), declared before
  the `:key` routes so the literal path wins.
- `backend/src/platform-settings/dto/platform-settings.dto.ts` — `UpdateBankDetailsDto`.
- `backend/src/portal/portal.service.ts` — `getInvoicePayOptions` now returns a
  `bank` object (from `PlatformSettingsService`); constructor gains the service.
- `backend/src/portal/portal.module.ts` — imports `PlatformSettingsModule`.
- `frontend/src/app/portal/case/pay/page.tsx` — the bank-transfer rows now read
  `opts.bank.*` instead of hardcoded strings (layout + copy buttons unchanged).
- `frontend/src/app/staff/platform-settings/page.tsx` — new **Bank details** card +
  inline editor; the Booking-URLs card is guarded to owner-tier only.
- `frontend/src/components/staff/shell/StaffSidebar.tsx` — `SETTINGS_ROLES` gains
  `ADMIN` so admins can reach the bank form.

**Test wiring:** `portal.service.spec.ts`, `portal.lia-notice.spec.ts`,
`portal.phase-b-notice.spec.ts` — third constructor arg (`PlatformSettingsService`
stub) added to the `new PortalService(...)` calls.

The new LIA-signed timing (the core change):

```ts
// handleDocusealWebhook, partial (!allCompleted) branch:
if (liaSigned && caseId) {
  await this.maybePromoteClientToStudent(contract.id, caseId);
  await this.maybeCreateEngagementInvoice(contract.id, caseId);
}
```

## 3. Database tables / columns added

**None — no schema migration was needed.** Piece 3 reuses the **existing
`platform_settings` key-value table** (added in PR-SCORECARD-4); the bank details
are just rows in it, written by the app. Prod schema was confirmed "up to date"
and the `platform_settings` table was empty (so the pay screen renders the
fallback defaults with zero data change until an admin first saves).

**The five setting keys** (category `bank`, defaults = the previously-hardcoded
pay-screen values):

| Key | Default |
|-----|---------|
| `BANK_NAME` | `Kiwibank` |
| `BANK_ADDRESS` | `Kiwibank Limited, Level 9, 20 Customhouse Quay, Wellington, 6011, New Zealand` |
| `BANK_ACCOUNT_NAME` | `SORENASTUDY LIMITED` |
| `BANK_ACCOUNT_NUMBER` | `38-9022-0355698-01` |
| `BANK_SWIFT` | `KIWINZ22` |

(The pay screen's Particular / Code / Reference rows stay dynamic — derived from
the client's name + Client ID — and are **not** configurable settings.)

## 4. Environment variables added (names only)

**None.** Phase C added no configuration. It reuses the existing engagement-fee
env (`ENGAGEMENT_FEE_CENTS` / `ENGAGEMENT_FEE_CURRENCY`, defaults 20000 / USD),
DocuSeal env, and the card-surcharge config — all unchanged.

## 5. Third-party services connected

**None new.** Builds entirely on the existing **Stripe** integration (the webhook
invoice reconciliation that flips a card-paid invoice to `PAID`) and the existing
**Finance confirm/reject queue** (`/staff/payments/*`) that a Finance/Accountant
uses to confirm bank-transfer / money-exchange receipts. No new account or key.

## 6. How to test it works

**A. Trigger timing — sign in Client → LIA → Director order**
1. Send an engagement contract (lead-based or case-based). Sign as the **Client**
   (first). Confirm: **no** `ENG-<caseId>` invoice yet, the client is still a
   `LEAD`, and (lead-based) the case has been auto-created.
2. Sign as the **LIA** (Director still pending). Confirm: the **`ENG-` invoice now
   exists** (status `SENT` — raised but unpaid, so access is still locked), and the
   **client is promoted to `STUDENT`**. The contract is still `SENT` (not fully signed).
3. Sign as the **Director** (submission completes). Confirm: **no second invoice**,
   **no re-promotion**, and the contract now shows **`SIGNED`**.

**B. Client-Officer button gate**
1. Log in as a **Client Officer** (`CLIENT_CONSULTANT`) and open a case's Payments
   tab → the **Create payment link / Custom link / Record manual payment** buttons
   are **gone**.
2. Log in as **Owner** or **Finance** and open the same tab → the buttons are still
   there and work.

**C. Admin-editable bank details**
1. As **Owner/Admin**, go to **Platform settings → Company bank details → Edit**,
   change a value (e.g. Account Number), Save.
2. Open a client's **unpaid** engagement invoice pay screen (`/portal/case/pay?…`)
   → the **Pay by bank transfer** section shows the **new** value, with the
   per-field **copy** buttons working. (Values fall back to the Kiwibank defaults
   until first edited, so nothing looks different before the first save.)

**Automated checks already green:** `contracts.phase-c.spec` (A's exact sequence +
retry idempotency + coalesced safety net); `contracts.phase-b.spec` + the portal
specs pass as a regression check.

## 7. Known limitations

- **(a) The three payment methods reuse the pre-existing flow.** Direct Stripe
  auto-reconciles the invoice to `PAID` via the webhook (instant unlock). **Bank
  transfer** and **money exchange** go through the already-built client
  receipt-upload → **Finance confirm** path (`Invoice.receiptMethod` = `bank` /
  `exchange`), which flips the invoice to `PAID` only on confirmation. That flow was
  already correct and was **not** touched by Phase C.
- **(b) The access allowlist was deliberately left as-is.** Only **Documents /
  Visa / Admission** are locked-until-paid; everything else (My Case, Assessment,
  Booking, Payments, Wallet, Messages, Dashboard) stays open so a restricted client
  can always see their case and pay. This was confirmed correct and unchanged.
- **(c) This is the final phase of the redesign.** Phases A (consultation +
  red-flag send gate), B (lead-based contracts + auto-case-on-client-sign), and C
  (payment-gated access) together make the lead → case → payment flow complete
  end-to-end. There is no Phase D planned.
- The engagement fee is minted as **USD 200** (env default). If the business
  intends NZD, set `ENGAGEMENT_FEE_CURRENCY=NZD` — a config change, not code.

## 8. How a future developer would extend this

- **The LIA-signed webhook branch** lives in `ContractsService.handleDocusealWebhook`
  (`backend/src/contracts/contracts.service.ts`), in the `if (!allCompleted)` block:
  it derives `clientSigned` / `liaSigned` from the synced signer rows and fires the
  invoice + promotion when `liaSigned && caseId`. The same two calls remain in the
  `allCompleted` branch as an idempotent safety net (see the boxed comment there) —
  do not remove that net.
- **Add a 4th payment method:** the client indicates method on receipt upload
  (`Invoice.receiptMethod`, currently `'bank' | 'exchange'`); widen the validation
  in `PortalService.uploadInvoiceReceipt` + the `ReceiptUpload` UI, and add a pay
  screen section. A method that settles through Stripe needs nothing new (the
  webhook reconciles by `metadata.invoiceId`); a method needing manual verification
  routes through the existing Finance confirm/reject queue — no gate change either
  way (the gate only cares that the invoice reaches `PAID`).
- **Add another admin-configurable field** following the bank-details pattern: add
  a key + default to `BANK_KEYS` (or a new `*_KEYS` block) in
  `PlatformSettingsService`, expose a `get*/update*` pair + a controller route
  (declared before `:key`), surface it where the client/consumer reads it, and add
  a card to `staff/platform-settings/page.tsx`. No migration — `platform_settings`
  is a generic key-value store.

## 9. Security layers applied

- **UI gate mirrors an already-enforced server boundary (defence in depth).** The
  new `CREATE_PAYMENT_ROLES` check on the payment buttons matches the backend
  `@Roles` on `POST /payments/case/:id/{consultation-link,custom-link,manual}`,
  which **already excludes** `CLIENT_CONSULTANT`. So a Client Officer could never
  generate a link/record a payment (server 403); Phase C just stops them seeing a
  button that would 403. The backend remains the real boundary.
- **Bank-detail edits are Owner/Admin only** — `GET`/`PATCH
  /staff/platform-settings/bank-details` are gated `@Roles('OWNER','SUPER_ADMIN',
  'ADMIN')` and every save writes a `BANK_DETAILS_UPDATED` audit row (who/when).
  The client-facing pay-options read is unauthenticated-of-secrets: bank details are
  public-by-design (a client must see them to pay), and are returned only alongside
  the caller's own ownership-verified invoice.
- **The access gate is unchanged and fail-safe.** `EngagementPaidGuard` /
  `getEngagementGateState` still resolve the caller's OWN case from the JWT and
  lock (403 / `paid:false`) on any error, missing case, or missing/unpaid invoice —
  Phase C only changed when the invoice is *created*, never how access unlocks.

## 10. Rollback instructions

Phase C is **code + settings-data only — no schema migration**, so rollback is a
git revert plus (optionally) clearing the settings rows.

1. **Revert the whole phase:** `git revert 4613e0d`. This restores the previous
   timing (invoice + promotion fire only at full 3-party completion), re-shows the
   payment buttons to all roles (the server-side block stays regardless), and
   reverts the pay screen + admin form to the hardcoded bank details.
2. **Revert ONLY the LIA-signed timing** (keep pieces 2 + 3): in
   `handleDocusealWebhook`, remove the `if (liaSigned && caseId) { maybePromote…;
   maybeCreateEngagementInvoice… }` block from the partial branch. The two calls
   still live in the `allCompleted` branch, so behaviour returns to
   "fires at full completion" with no other change. (Both helpers are idempotent, so
   this is safe even mid-flight.)
3. **Revert ONLY the bank details to hardcoded** (keep pieces 1 + 2): restore the
   literal `bankRows` values in `frontend/src/app/portal/case/pay/page.tsx` and stop
   reading `opts.bank`. Optionally delete the five `BANK_*` rows from
   `platform_settings` (or leave them — they're inert once the page ignores them).
   The `platform_settings` snapshot taken before this phase (empty) is in the
   scratchpad backup for reference.
4. No env-var or third-party rollback is needed; existing invoices, payments, and
   the Finance confirm queue are unaffected either way.
