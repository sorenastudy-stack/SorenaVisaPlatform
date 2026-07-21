# Phase 8 — Contract Webhook E2E + Portal Identity Linking

End-of-phase handover for the work that took the engagement-contract funnel from
"engine exists but never proven end-to-end" to a **verified, passing** flow, plus
the bug fixes and one production-data repair that unblocked it.

**Date:** 2026-07-21
**Commits:** `ade08e5`, `da19da8`, `918be13`, `24c4e1f`, `83074ee` (+ `278f410` rebuild trigger)

---

## 1. What it does

Proves and hardens the full client on-ramp:

> **lead → case → contract sent → 3 signatures → DocuSign webhook → engagement invoice → client Pay-now**

- **End-to-end webhook test: PASSED.** A fresh lead was converted to a case, the
  engagement contract was sent, all three parties (CLIENT → LIA → DIRECTOR) signed,
  the DocuSign Connect webhook fired, and the system auto-created the engagement
  invoice (`ENG-<caseId>`, SENT) and captured the signed PDF + `visaType`.
  - Lead `cmrty98gc0015qy011iitjtes` → Case `cmrubeq020003ql012tflxnt1` →
    Contract `cmrubgvey000fql019bbohj6d` (**SIGNED**) → Invoice
    `ENG-cmrubeq020003ql012tflxnt1` (**SENT, USD 200**).
- Along the way we found and fixed the defects that made the flow silently fail:
  a null-`riskLevel` crash on lead→case conversion, and a "contact-split" identity
  bug that hid the case + invoice from the client portal.
- The client portal Payments surfaces now route to the **real Stripe checkout**
  instead of a dead-end history page.

### The bug fixes shipped
| Commit | Fix |
|---|---|
| `ade08e5` | **null riskLevel on lead→case conversion** — `createCase` passed `riskLevel: lead.riskLevel` (null for leads with no risk), which Prisma rejected against the non-nullable `RiskLevel @default(LOW)` column and **mis-reported as `Argument \`lead\` is missing`**. Now `?? undefined` so the DB default applies. This was the actual blocker on case creation. |
| `da19da8` | **contact-split auto-linking + promotion resilience** — new `linkCaseContactToUser` helper links a case-bearing contact to its login user by email (respecting the `Contact.userId @unique` constraint); called from both lead→case paths; `maybePromoteClientToStudent` now attempts the link before bailing. |
| `918be13` | **portal pay-now dead link** — Home "Payments" tile + `/student/payments` now surface the outstanding invoice with a real Pay-now button (reusing the My Case checkout), instead of a history-only dead end. |
| `24c4e1f` | **currency display** — the Home tile shows the outstanding amount in the invoice's own currency (was hardcoded NZD). |

---

## 2. Files changed

**Backend**
- `backend/src/cases/cases.service.ts` — `riskLevel: lead.riskLevel ?? undefined`; call `linkCaseContactToUser` after case creation.
- `backend/src/common/link-case-contact.helper.ts` — **new.** `linkCaseContactToUser(prisma, caseId)`: email-match link with `@unique` conflict handling; never throws; writes a `CONTACT_AUTO_LINKED_TO_USER` audit row.
- `backend/src/common/link-case-contact.helper.spec.ts` — **new.** 8 unit tests (link, idempotency, no-email/no-user skips, `@unique` conflict skip-vs-move, never-throw).
- `backend/src/leads/leads.service.ts` — call `linkCaseContactToUser` after its case create (idempotent no-op there; uniform protection).
- `backend/src/contracts/contracts.service.ts` — `maybePromoteClientToStudent` tries the email link when `contact.userId` is null before giving up.
- `backend/README.md` — created (one-line marker) to force a backend rebuild (`278f410`).

**Frontend**
- `frontend/src/app/student/page.tsx` — Payments tile → Pay-now via `PayInvoiceButton` when a balance is due; amount in the invoice's currency.
- `frontend/src/app/student/payments/page.tsx` — Outstanding (SENT/OVERDUE) invoice section with Pay-now above history.

**Docs**
- `docs/CONTRACT_SEND_BUTTON.md` — §11 recording that the `visaType` rule is template-owned + the go-live re-apply warning.
- `docs/PHASE_8_WEBHOOK_E2E_AND_PORTAL_LINKING.md` — this handover.

No new components or routes were built — the Pay-now path reuses the existing
`PayInvoiceButton` → `POST /portal/me/invoices/:id/pay-link` → Stripe.

---

## 3. DB changes

- **No schema migration.** Nothing schema-level changed this phase.
- **New audit action string:** `CONTACT_AUTO_LINKED_TO_USER` (written by the linker;
  `audit_logs.action` is free text, so no migration needed). Existing action strings
  `INVOICE_CREATED_ON_SIGN`, `CLIENT_PROMOTED_TO_STUDENT`, `CONTRACT_SIGNED_PDF_STORED`
  are reused by the webhook path.
- **One-time production data repair (Oscar)** — see §3a. This was a manual data edit,
  not a migration.

### 3a. One-time production data repair — Oscar (`oscarbach@sorenavisa.com`)

Before the `da19da8` code fix existed, Oscar's data was split across two Contact rows
(the "contact-split" bug): the case-bearing contact had `userId = NULL` while his login
user was linked to a case-less duplicate. This was repaired **manually, once**, against
the production DB (Railway `peaceful-imagination/production/Postgres`):

1. **Backup first** — full CSV of `contacts` (25 rows) + `users` (17 rows) and an exact
   before-snapshot of the 3 affected rows → session scratchpad `oscar-repair/`.
2. **Transaction 1 (contact re-link):** cleared `userId` on stray contact
   `cmrsopkyy000fqy01exduowyt`; set `userId = cmrsoim5u0000qy01o3y4522m` on the
   case-bearing contact `cmrsoim6t0001qy01qsek5t8k` (clear-first to satisfy `@unique`).
3. **Transaction 2 (promotion):** user `cmrsoim5u…` role `LEAD → STUDENT` (guarded
   `AND role='LEAD'`), plus a matching `CLIENT_PROMOTED_TO_STUDENT` audit row.
4. **Verified** the exact portal query (`case WHERE lead.contact.userId = cmrsoim5u…`)
   returns case `cmrubeq…`, the `ENG-` invoice resolves, and stage inputs → STAGE_2.

**This is a one-time repair.** The `da19da8` code fix prevents recurrence. A production
scan afterward found **zero** other case-bearing contacts in the split state.

---

## 4. Environment variables

**No new env vars this phase.** Relevant existing ones (unchanged):
- `ENGAGEMENT_FEE_CENTS` (default 20000), `ENGAGEMENT_FEE_CURRENCY` (default USD) — the
  auto-created engagement invoice amount.
- `CARD_SURCHARGE_CENTS` (default 2000) — card surcharge added to the Stripe charge only.
- `DOCUSIGN_TEMPLATE_ID` — the composite-template id (see §5 / §7).

---

## 5. Third-party services

- **DocuSign** — sends the engagement envelope and delivers the completion webhook
  (Connect). The envelope is a **composite-template send**: our code references the
  template by `DOCUSIGN_TEMPLATE_ID` and sets **no signer tabs** — the template owns all
  fields, including the `visaType` checkboxes (see §4/§8 of `CONTRACT_SEND_BUTTON.md`).
- **Stripe** — the Pay-now button generates a hosted checkout via
  `POST /portal/me/invoices/:id/pay-link`. Payment **completion** reconciliation (the
  webhook that flips the invoice to PAID) is **not yet E2E-verified in live mode** — see §7.

---

## 6. How to test

**Webhook E2E (the headline flow):**
1. Find a lead that passes the execution gate (`executionAllowed = true`,
   `hardStopFlag = false`) with an email on its contact.
2. `/staff/leads/[id]` → **Create case** (or `POST /cases { leadId }`). Confirm the case
   is created (this is where the null-`riskLevel` bug used to fire).
3. On the case, **Send engagement contract** → auto-assigns the LIA + Admission + Finance
   and dispatches the CLIENT→LIA→DIRECTOR envelope.
4. Complete all three DocuSign signatures.
5. Expect: Contract → **SIGNED**; an `ENG-<caseId>` invoice **SENT**; a signed-PDF
   `Document`; `Case.visaType` captured; and (if the client's contact is linked) the
   user promoted **LEAD → STUDENT**.
6. Log in as the client → `/student` Home tile shows the outstanding amount +
   **Pay now**; `/student/payments` shows the outstanding invoice above history.

**Auto-link unit tests:** `cd backend && npx jest src/common/link-case-contact.helper.spec.ts` (8/8).

**Builds:** backend `npm run build` (nest) and frontend `npm run build` (next) both clean;
frontend `npx tsc --noEmit` → 0 errors.

---

## 7. Known limitations / remaining items

- **Stray duplicate contact not cleaned up** — Oscar's now-unlinked stray contact
  `cmrsopkyy000fqy01exduowyt` (no email, no case) still exists. Benign, but should be
  merged/deleted in a CRM-hygiene pass.
- **Stripe payment-completion webhook not E2E-tested in live mode** — the Pay-now →
  hosted-checkout leg works; the `payment_intent.succeeded` → invoice-PAID reconciliation
  has not been proven end-to-end against **live** Stripe. Next test target.
- **Frontend error messages are generic** — several client-portal calls surface a generic
  "could not…" toast/message that **hides the real server error**, which slowed diagnosis
  this phase. Consider surfacing the backend message (as the contract-send panel does).
- **`visaType` "select exactly 1" is on the DEMO template only** — see §8; production must
  get the same rule at go-live.
- **DocuSign integration tests need a DB** — `contracts.service.spec.ts` webhook
  integration tests fail in environments with no reachable test DB (pre-existing; not a
  regression).

---

## 8. DocuSign `visaType` rule — template-owned (⚠️ go-live action)

- The `visaType` checkbox group and its validation live **in the DocuSign template**, not
  our code (composite-template send, no signer tabs). Full detail in
  `docs/CONTRACT_SEND_BUTTON.md` §11.
- **Applied today:** "**select exactly 1**" validation was set on the **demo/sandbox**
  template `c1c1b0f6-533e-4427-98db-c45cd5c666e8`
  (`account-d.docusign.com` / `demo.docusign.net`).
- **⚠️ Go-live requirement:** production uses a **different** template object under a
  **different** DocuSign account. The "select exactly 1" `visaType` rule **must be
  re-applied to the production template** — it does not carry over from demo. Put this on
  the go-live checklist. (Our code only *reads* the selection and tolerates none, so the
  template is the only place this is enforced.)

---

## 9. How to extend

- **CRM contact de-dup** — a tool/job to merge split contacts (like Oscar's) rather than
  relying on the auto-linker's stray-move heuristic; surface conflicts the linker refuses
  to auto-resolve (`user_linked_to_contact_with_cases`) for a human.
- **Stripe completion E2E** — prove `payment_intent.succeeded` → invoice PAID → portal
  "Payment received" in live mode; add a monitored reconciliation.
- **Server-error surfacing** — thread real backend messages through the client-portal
  error toasts.
- **Contract re-send / void** — still no UI to void a DocuSign envelope and re-issue
  (one contract per case via `Contract.caseId @unique`).

---

## 10. Security layers applied

- **Tenancy is the query, not a downstream check** — the linker and every portal read
  resolve ownership via `lead.contact.userId`; the client never supplies an id.
- **`@unique` respected** — the linker only re-points a user's link off a **case-less**
  stray contact; if the other contact owns cases it **refuses and logs** rather than
  risk stealing a live identity.
- **Never-throw, best-effort** — the linker and promotion paths never break case creation
  or the webhook; every failure logs and returns a non-linked result.
- **Auto-link is email-gated + null-guarded** — only links a contact with **no** `userId`
  yet, to a User whose email matches (case-insensitive); it never hijacks a linked contact
  and never creates users/contacts.
- **Audit trail** — auto-links write `CONTACT_AUTO_LINKED_TO_USER`; the manual repair wrote
  `CLIENT_PROMOTED_TO_STUDENT`; the webhook writes `INVOICE_CREATED_ON_SIGN` /
  `CONTRACT_SIGNED_PDF_STORED`.
- **Pay-link amount is server-authoritative** — the client supplies only `invoiceId`; the
  amount + surcharge are read/derived server-side and ownership re-verified.

---

## 11. Rollback

- **Code:** revert the commits `ade08e5`, `da19da8`, `918be13`, `24c4e1f` (and doc `83074ee`).
  No DB migration to undo. Reverting `da19da8` removes the auto-linker; the null-`riskLevel`
  revert (`ade08e5`) would **re-break** case creation, so don't revert that one alone.
- **The Oscar data repair is NOT reverted by a code rollback** — it was a one-time manual
  data edit. Before/after CSVs are in the session scratchpad `oscar-repair/` if a manual
  undo is ever needed.
- **DocuSign template change** is in the DocuSign UI, not git — revert there if needed.
