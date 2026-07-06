# Contract → Sign → Pay → Receipt funnel — code map

Read-only scan of the whole repo (backend + frontend). For each stage: **EXISTS /
PARTIAL / MISSING** with the exact files + routes/functions that prove it. No code was
changed.

**One-line summary:** the DocuSign *engine* (send + sign + auto-promote) and the Stripe
*engine* (payment links + receipt email) are real, but the **connective tissue is
missing**: there is no UI to send a contract, no code that turns a signed contract into
a payable link, and no in-portal receipt view. The funnel cannot run without manual API
calls.

## Stage-by-stage

| Stage | Status | Files (route / function) | Notes |
|---|---|---|---|
| **1 — Contract send** | **PARTIAL** (backend real, no UI) | **UI: MISSING** — grep of `frontend/src` for `/contracts` / "send contract" returns **zero** callers (no client button, no staff button). **Backend: EXISTS** — `backend/src/contracts/contracts.controller.ts:20` `@Post()` `createContract` (`@Roles OWNER/SUPER_ADMIN/ADMIN/LIA`) → `contracts.service.ts:110` `createContract()` → `docusign.service.ts` `createEnvelope()` (called `contracts.service.ts:246`), sets `Contract.status = SENT` (`:265`). **Schema:** `prisma/schema.prisma:1607` `model Contract` — `caseId String @unique` (1:1 case↔contract), `docusignEnvelopeId`, `status ContractStatus`, `signedAt`, `signers ContractSigner[]`. | The envelope can currently only be sent by hitting `POST /contracts` **by hand**. This is the #1 funnel dead-end — even staff have no button. Contract is attached to a case via the unique `caseId` FK. |
| **2 — Sign** | **EXISTS** | **Webhook:** `contracts.controller.ts:40` `@Post('webhook')` `handleWebhook` (guarded by `DocusignWebhookGuard`) → `contracts.service.ts:375` `handleWebhook(envelopeId)`. On status update it maps DocuSign→`ContractStatus` (`contract-status.ts` `docusignToContractStatus`), flips **per-signer** `ContractSigner.signedAt` (`:429–431`) and the parent **`Contract.status` / `Contract.signedAt`** (`:456–460`). **Auto-promote:** `contracts.service.ts:514` calls `maybePromoteClientToStudent()` (defined `:525`). | Field that flips on **client** sign: the CLIENT/GUARDIAN `ContractSigner.signedAt` row. On **LIA** sign: the LIA `ContractSigner.signedAt` row (`schema.prisma:1655 model ContractSigner`, distinguished by `role`). `Contract.status → SIGNED` + `Contract.signedAt` set when the envelope completes. Promotion fires only when a CLIENT/GUARDIAN **and** the LIA both have `signedAt` (director ignored) → user role `LEAD → STUDENT` (`maybePromoteClientToStudent`, `contracts.service.ts:525`). Real and correct — but unreachable until Stage 1 sends an envelope. |
| **3 — Pay** | **PARTIAL** (link engine exists; not wired to sign; not client-surfaced) | **Link creation EXISTS:** `payments/stripe.service.ts:120` `createConsultationPaymentLink`, `:218` `createCustomAmountPaymentLink`, `:28/:89` `createCheckoutSession`. Exposed at `payments/payments.controller.ts:70` `@Post('case/:caseId/consultation-link')`, `:91` `@Post('case/:caseId/custom-link')`, `:122` `@Post('case/:caseId/manual')` — **all `@Roles` STAFF only** (OWNER/ADMIN/LIA/CONSULTANT/SUPPORT/FINANCE), **no client role**. **Post-sign automation: MISSING** — `contracts.service.ts handleWebhook` does promotion + LIA-assign but **never creates a payment link/invoice**. **Client surface:** `portal/portal.service.ts:103` `buildNextSteps` emits a `kind:'INVOICE'` step ("Pay invoice …") from `Invoice` rows (status SENT/OVERDUE), rendered on `frontend/src/app/portal/case/page.tsx` — **but the page only renders a clickable link for `DOCUMENT`/`CONTRACT` kinds (`page.tsx:204`); INVOICE shows text with no pay button.** | Where a pay link *would* belong: the **"What to do next"** block on **`frontend/src/app/portal/case/page.tsx`** (the INVOICE next-step), and/or `/student/payments`. Today: staff must manually call `custom-link`, and the returned Stripe URL is **not stored on the Invoice nor shown to the client** — so a client sees "Pay invoice X" as inert text. No automatic "you signed → here's your bill" path. |
| **4 — Receipt** | **PARTIAL** (emailed, but no in-portal view) | **In-portal view: MISSING** — `frontend/src/app/student/payments/page.tsx` is a **"Coming soon" stub** (`:27–35`); ironically its subtitle reads "Your invoices, receipts, and payment history." **Receipt email: EXISTS** — `payments/payments.controller.ts:348` (inside the `@Post('webhook')` `payment_intent.succeeded` handler) calls `this.mail.sendConsultationConfirmation(...)` → `mail/mail.service.ts:305` (subject **"Payment received — Sorena Visa"**, body `consultationConfirmationBody`, template note `mail/mail.templates.ts:287` "PR-PAYMENTS-RECEIPT"), sent via **Resend**. | A paying client **does** get a receipt email (Resend; falls to mock/log if `RESEND_API_KEY` unset). They **cannot** see any receipt/invoice/history **in the portal** — the dedicated page is a placeholder. Backend has `GET /payments/case/:caseId` (`payments.controller.ts:111`, staff-only) and `GET /students/me/invoices`, but nothing client-facing renders receipts. |

## Biggest gaps, smallest-first

1. **Add a staff "Send engagement letter" button** (smallest, highest leverage). The
   backend `POST /contracts` → DocuSign is fully built; it just has no caller. A single
   button on the staff case/lead page unblocks the *entire* downstream funnel (sign →
   promote → Stage 2). Frontend-only.
2. **Make the client's INVOICE next-step clickable.** `buildNextSteps` already emits the
   INVOICE step; `/portal/case` just doesn't render a link for it. Store the Stripe
   payment-link URL on the `Invoice` (or fetch on demand) and render a "Pay now" link
   the same way `DOCUMENT`/`CONTRACT` steps render "Open" (`portal/case/page.tsx:204`).
   Small FE + a small BE field/endpoint.
3. **Build the `/student/payments` receipts view** to replace the "Coming soon" stub —
   list invoices/payments + receipts for the signed-in client (needs a client-scoped
   read endpoint; today `GET /payments/case/:caseId` is staff-only). Medium FE + a small
   BE endpoint.
4. **Auto-generate the service-fee payment link/invoice on contract sign** — wire a
   post-sign step into `contracts.service.ts handleWebhook` (or a dedicated hook) so a
   signed contract produces a payable Invoice + Stripe link automatically, instead of a
   staff member manually calling `custom-link`. Medium BE wiring; do this once #1–#2
   prove the path manually.

**Already done (no work needed):** the DocuSign send/sign/webhook engine, the
LEAD→STUDENT auto-promotion, the Stripe payment-link + checkout engine, and the
**payment-receipt email** (Resend). The launch gap is *integration UI + surfacing*, not
missing payment/contract engines.
