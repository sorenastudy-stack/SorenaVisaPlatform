# PHASE 6 + 6.5 — Payments (Stripe Links, Manual Payments, Finance Verification)

> Handover document. Written so a developer joining in 6 months can read **only this file** and understand the entire Payments system completely.
>
> **Status:** ✅ Done and live in production.
> **Live frontend:** [prod frontend URL]
> **Live backend:** [prod backend URL]
> **Final commit on `main`:** `d981862` (Phase 6.5 frontend — verification UI)
> **Date completed:** 2026-06-18
>
> Replaces the original 2026-04-27 doc (`ef8a26e` era), which described an earlier link-generation-only milestone. The historical incident note and Prisma-on-Alpine debug log are preserved in the appendix.

---

## 1. What this phase does — plain English

Sorena now has a working payments workflow on the case detail page that finance can stand behind.

**For sales / consultant staff** — on every case there's a **Payments tab**. From there they can:
1. **Create a Stripe payment link** for any of five consultation types (Gap Closing, Admission Consultation $50, LIA Consultation $150, Account Opening $200, Free Session) and send it to the client manually (WhatsApp/email). The link metadata carries the caseId so the webhook can tie the resulting Payment row back to this case directly.
2. **Record a manual payment** when the client pays out-of-band (cash, bank transfer, wire). The manual form REQUIRES uploading a receipt — bank screenshot, scan, or wire confirmation. The receipt is stored via the existing Phase 5 document pipeline. No receipt → no payment row.
3. **See the full payment history** for the case — both direct (Stripe + manual) and indirect (consultation/subscription paid against the lead before the case existed).

**For finance staff (FINANCE / OWNER / ADMIN)** — every payment now lives in one of three verification states: **PENDING** (just landed, awaiting review), **CONFIRMED** (finance signed off), **REJECTED** (finance flagged it — wrong amount, bad receipt, suspected duplicate). Finance see Confirm/Reject buttons next to every PENDING row, click Confirm to approve, or open an inline reason field and Reject. Both decisions are audit-logged with the actor's id + role + name snapshot. The reject reason is **required**.

**Behind the scenes** — the Stripe webhook (`POST /payments/webhook`) listens for `payment_intent.succeeded`, idempotently writes a Payment row (using `stripePaymentIntentId` as the unique key — Stripe retries land as no-ops), and explicitly sets `verificationStatus: 'PENDING'` so Stripe successes also wait for finance sign-off. The webhook also auto-assigns an LIA when an ACCOUNT_OPENING charge lands on a case whose contract is signed (PR-LIA-AUTO-ASSIGN, unchanged from Phase 5).

**Currently in Stripe TEST mode.** Real money does NOT move yet — the live key swap is the only thing needed to flip this to production payments (see §4).

---

## 2. Files created or changed

Repo: `https://github.com/sorenastudy-stack/SorenaVisaPlatform`. Paths relative to repo root.

### Backend (NestJS — Railway)

| File | Purpose |
|------|---------|
| `backend/src/payments/stripe.service.ts` | `createConsultationPaymentLink(leadId, type, amount, currency, caseId?)` calls `stripe.prices.create` then `stripe.paymentLinks.create`. **Bug fix (e3a3760)** removed `description` from the inline `product_data` — the Prices API rejects that field with `"Received unknown parameter: product_data[description]"`. The decorative tagline is gone; the product `name` (e.g. "Admission Consultation") still renders on the hosted page. **Do not re-add it.** |
| `backend/src/payments/payments.service.ts` | Service layer. Five methods: `createConsultationPaymentLink` (still exists, leadId-keyed, used by the legacy `/payments/consultation-link` route), `createConsultationLinkForCase` (Phase 6 — resolves leadId from caseId), `listPaymentsForCase` (whitelisted shape — see §3 for fields, includes batched verifier-name resolution), `recordManualPayment` (Phase 6 + 6.5 — receipt validation + atomic Payment+AuditLog write + `verificationStatus: 'PENDING'`), `confirmPayment` / `rejectPayment` (Phase 6.5 — transition guards, 409 on already-verified, audit row in tx). Private `transitionVerification` helper dedupes the confirm/reject internals. |
| `backend/src/payments/payments.controller.ts` | Routes — see §2 "Live routes" table below. Webhook handler `handlePaymentSucceeded` now writes `verificationStatus: 'PENDING'` to the Payment row. |
| `backend/src/payments/dto/create-payment-link.dto.ts` | Exports the `CONSULTATION_TYPES` constant (single source of truth) and `CreatePaymentLinkDto` for the legacy leadId-keyed route. |
| `backend/src/payments/dto/create-case-consultation-link.dto.ts` | **NEW (dbdf1b5).** Phase 6 — body DTO for the case-keyed route. Just `{ consultationType }`, validates against the same `CONSULTATION_TYPES` import (no duplication). |
| `backend/src/payments/dto/record-manual-payment.dto.ts` | **Phase 6.5** — `receiptDocumentId: string` is now **required**. Amount is integer cents (`@IsInt @Min(1)`). |
| `backend/src/payments/dto/verify-payment.dto.ts` | **NEW (003e634).** Body DTO for confirm. Optional `note` (max 500 chars). |
| `backend/src/payments/dto/reject-payment.dto.ts` | **NEW (003e634).** Body DTO for reject. `note` is **required** (`@IsNotEmpty`, max 500) — a rejection without a reason is a footgun for everyone downstream. |
| `backend/prisma/schema.prisma` | **Phase 6.5.** New enum `PaymentVerificationStatus { PENDING CONFIRMED REJECTED }` and five new columns on `Payment` (see §3). |
| `backend/src/payments/payments.service.spec.ts` | 26 unit tests — list shape (incl. batched verifier-name lookup), receipt validation (missing / foreign-case / still-PENDING upload), confirm + reject (transitions, audit row, optional-vs-required note, 404, 409), consultation-link delegation. Hand-rolled Prisma mocks; no Nest boot. |
| `backend/src/payments/payments.controller.webhook-verification.spec.ts` | **NEW (003e634).** 3 unit-mocked tests confirming the webhook writes `verificationStatus: 'PENDING'` for consultation, ACCOUNT_OPENING, and the fallback subscription branch. No real DB. |

**Live routes** (all under `POST /payments/...` or `GET /payments/...`):

| Method + path | Roles | What it does |
|---|---|---|
| `POST /payments/consultation-link` | JWT only (legacy) | Creates a Stripe link by leadId. Kept for backward compat. |
| `POST /payments/case/:caseId/consultation-link` | OWNER/SUPER_ADMIN/ADMIN/LIA/CONSULTANT/SUPPORT/FINANCE | **Phase 6** — case-keyed convenience for the staff UI. Resolves leadId server-side; threads caseId into Stripe link metadata. |
| `GET /payments/case/:caseId` | same staff list | Lists payments tied to the case (direct via `Payment.caseId`, indirect via `lead.cases`). Returns the whitelisted shape with verification fields + batched `verifiedByName`. |
| `POST /payments/case/:caseId/manual` | same staff list | Records a manual payment. **Requires `receiptDocumentId`** (validated to exist + belong to this case + be `UPLOADED`). Lands `PENDING`. |
| `POST /payments/:paymentId/confirm` | **OWNER / ADMIN / FINANCE only** | Phase 6.5. PENDING → CONFIRMED + audit. Returns 409 if already CONFIRMED/REJECTED. |
| `POST /payments/:paymentId/reject` | **OWNER / ADMIN / FINANCE only** | Phase 6.5. PENDING → REJECTED + audit. Note required at DTO **and** service layer. Returns 409 if already CONFIRMED/REJECTED. |
| `POST /payments/webhook` | Stripe signature only (no JWT, `@SkipThrottle`) | Idempotent Payment write keyed on `stripePaymentIntentId`; LIA auto-assign on ACCOUNT_OPENING + signed contract; sets `verificationStatus: 'PENDING'`. |

Other historical routes (`/payments/consultation/checkout`, `/payments/subscription/checkout`) exist but are unused by the new staff UI — they predate the Payment Link flow.

### Frontend (Next.js — Vercel)

| File | Purpose |
|------|---------|
| `frontend/src/components/cases/CasePaymentsPanel.tsx` | **NEW Phase 6 (825c65b), EXTENDED Phase 6.5 (d981862).** The staff Payments tab. Mirrors `CaseDocumentsPanel` structure (useCallback fetch, useEffect on mount, `refresh()` after every mutation, same section / banner / empty-state / list idioms). Render branches: list, link form, manual form (with required receipt picker + 2-stage progress label `Uploading receipt…` → `Recording payment…`), inline reject reason form. Status badges (amber PENDING / emerald CONFIRMED / rose REJECTED). Per-row receipt view link reuses `getCaseDocumentDownloadUrl`. Money math is cents on the wire, EPSILON-safe round of dollar input. |
| `frontend/src/lib/case-documents.ts` | **NEW (d981862).** Shared Phase 5 document helpers — `uploadCaseDocument(caseId, file)` (3-step request-upload → raw PUT → confirm) and `getCaseDocumentDownloadUrl(caseId, documentId)`. Extracted so the Payments tab's receipt upload doesn't duplicate the bytes-to-R2 sequence already living in `CaseDocumentsPanel`. The Documents panel keeps its inline copy untouched — a follow-up can switch it to this helper. |
| `frontend/src/components/staff/cases/detail/CaseTabs.tsx` | Phase 6 — added `'payments'` to the `CaseTab` union and inserted the tab entry between Documents and Meetings. |
| `frontend/src/components/staff/cases/detail/CaseDetailClient.tsx` | Phase 6 — imports `CasePaymentsPanel` and renders it when `tab === 'payments'`. |
| `frontend/src/i18n/messages/en.json` + `fa.json` | Added `staff.cases.detail.tabs.payments` plus a large `staff.cases.detail.payments.*` block covering button labels, form labels, badge text, success/error microcopy, consultation-type friendly labels, verification statuses, receipt upload progress states, reject-reason field, and the 409 "already reviewed by someone else" message. English + Persian. |

### Role-gating hook used

`useStaff()` from [`@/contexts/StaffContext`](frontend/src/contexts/StaffContext.tsx). The Payments tab reads `me.role` and gates the Confirm/Reject buttons via `VERIFICATION_ROLES = new Set(['FINANCE', 'OWNER', 'ADMIN'])`. Same hook used by `StaffSidebar`, `StaffTopBar`, the Approvals page, and ~10 other staff components — no new hook, no hardcoded list anywhere else.

---

## 3. Database tables / columns added

⚠️ **Migrations do NOT auto-apply on this project.** Every schema change is run by hand against Railway Postgres via the Data tab. Prisma's migration files are not deployed. Future schema changes follow this same pattern.

### Phase 6 — none

The Stripe link + manual payment work in Phase 6 did NOT add columns. It used the pre-existing `Payment` model (`id`, `stripePaymentIntentId`, `leadId`, `caseId?`, `paymentType`, `amount`, `currency`, `status`, `metadata`, `createdAt`) and threaded a synthetic `stripePaymentIntentId` of the form `manual_<uuid>` for manual rows so the existing `@unique` constraint stays idempotent.

### Phase 6.5 — new enum + five columns on `payments`

**Applied manually on 2026-06-18 against Railway Postgres**, in this exact order (each statement is a single line, ready to paste one at a time into the Railway Data tab):

```sql
CREATE TYPE "PaymentVerificationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
```

```sql
ALTER TABLE "payments" ADD COLUMN "verificationStatus" "PaymentVerificationStatus" NOT NULL DEFAULT 'PENDING', ADD COLUMN "verifiedById" TEXT, ADD COLUMN "verifiedAt" TIMESTAMP(3), ADD COLUMN "verificationNote" TEXT, ADD COLUMN "receiptDocumentId" TEXT;
```

The matching Prisma schema change (committed in `003e634`):

```prisma
enum PaymentVerificationStatus {
  PENDING
  CONFIRMED
  REJECTED
}

model Payment {
  // … existing columns …
  verificationStatus PaymentVerificationStatus @default(PENDING)
  verifiedById       String?
  verifiedAt         DateTime?
  verificationNote   String?
  receiptDocumentId  String?
}
```

**Backfill — deliberately NOT run.** A third statement (`UPDATE "payments" SET "verificationStatus" = 'CONFIRMED' WHERE "verificationStatus" = 'PENDING';`) was prepared but skipped intentionally so the two pre-existing test rows would stay PENDING and exercise the new finance flow. Run it later only if you decide to grandfather pre-feature payments as already-approved. **Do not run it blindly** — it flips every PENDING row to CONFIRMED, including any new ones that arrive between the ALTER and the UPDATE.

**Field-by-field reasoning:**

- `verificationStatus PaymentVerificationStatus @default(PENDING)` — the only NOT NULL addition; safe because the column default makes the migration zero-downtime.
- `verifiedById String?` — plain nullable String, **no Prisma relation**. Adding `verifiedBy User?` would force a back-relation field on the User model, which we explicitly avoided. The convention follows `CrmEvent.actorId` (also a plain nullable string). The display name is resolved server-side at read time via one batched `user.findMany({ where: { id: { in: [...] } } })` and returned as `verifiedByName` on each row.
- `verifiedAt DateTime?` — null until verified.
- `verificationNote String?` — confirm note OR reject reason (the type distinguishes them).
- `receiptDocumentId String?` — **nullable at the DB level** even though the app REQUIRES a receipt for new manual payments. Existing Stripe rows have no receipt; a NOT NULL column would have broken them. The "required for manual" rule is enforced in the service layer.

**`listPaymentsForCase` returned shape** (whitelisted, with comments since the FE keys off these):

```ts
{
  id, amount, currency, status, paymentType, createdAt, isManual,
  verificationStatus,           // 'PENDING' | 'CONFIRMED' | 'REJECTED'
  verifiedById,                 // string | null
  verifiedByName,               // string | null — resolved server-side
  verifiedAt,                   // ISO date | null
  verificationNote,             // string | null
  receiptDocumentId,            // string | null
}
```

The query uses `OR: [{ caseId }, { lead: { cases: { some: { id: caseId } } } }]` so both directly-linked payments (`ACCOUNT_OPENING`, manual) AND indirectly-linked ones (consultations paid against the lead before the case existed) show up. The select is explicit field picking — `metadata`, `stripePaymentIntentId`, `leadId`, raw `caseId` are deliberately omitted.

---

## 4. Environment variables added

Set in **Railway → SorenaVisaPlatform → Variables**:

| Name | Used for |
|------|----------|
| `STRIPE_SECRET_KEY` | Server-side Stripe SDK calls (link creation, webhook signature verification setup). **Currently a TEST-mode key** (`sk_test_…`). Never logged, never returned to the client. Frontend has no Stripe key. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification (`stripe.webhooks.constructEvent`). Set per environment in the Stripe Dashboard → Developers → Webhooks endpoint configuration. |

**Going live with real money:** swap `STRIPE_SECRET_KEY` from `sk_test_…` to `sk_live_…` in Railway, and update `STRIPE_WEBHOOK_SECRET` to the live webhook's signing secret. No code change required. Until that swap, every Stripe Payment Link is a sandbox link — clients clicking through hit Stripe's test checkout (use card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode).

⚠️ `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are **not** listed in `backend/.env.example`. They should be — that file documents required env vars for local dev. Add them with empty defaults (`STRIPE_SECRET_KEY=""`) as a follow-up so a new dev's local boot doesn't silently disable payments.

---

## 5. Third-party services connected

| Service | Why | Where to manage |
|---------|-----|-----------------|
| **Stripe** | Payment Link generation, hosted checkout, card processing, webhooks | https://dashboard.stripe.com — **currently in TEST mode**. Switch to Live mode in the dashboard's top-left dropdown to see / configure live keys + webhooks. |
| **Cloudflare R2** | Receipt file storage (inherited from Phase 5 — manual-payment receipts are just Phase 5 documents) | Cloudflare dashboard → R2 → existing Phase 5 bucket. No bucket/CORS change for Phase 6.5. |

The Stripe webhook URL configured in the Stripe Dashboard points to `POST [prod webhook URL]` (no JWT — protected by Stripe signature verification using `STRIPE_WEBHOOK_SECRET`). When swapping to live mode, register the live webhook URL too and copy its signing secret into Railway.

---

## 6. How to test it works (manual test)

**End-to-end Stripe link flow (test mode):**

1. Sign in to the staff app as OWNER/ADMIN/CONSULTANT/SUPPORT/FINANCE/LIA. Open any case.
2. Click the **Payments** tab.
3. Click **Create payment link**. Choose a consultation type (e.g. *Admission Consultation ($50)*). Click **Generate**.
4. Expect a Stripe Checkout URL in a read-only field with a gold **Copy** button. Click Copy → "Copied" confirmation for 2s.
5. Paste the URL into an incognito window. The hosted Stripe page should render with the consultation name + amount.
6. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
7. Within a few seconds: the Stripe Dashboard → Payments page shows the charge; the Payments tab back in Sorena (refresh the page) shows a new row with the amount + **Stripe** badge + amber **Awaiting finance review** badge.

**Manual payment + receipt:**

1. From the Payments tab, click **Record manual payment**.
2. Enter an amount (e.g. `50.00`), keep currency `NZD`, optionally add a note.
3. Click **Choose receipt file**, pick a PDF/JPG/PNG under 15 MB. The filename appears with a "Change" link.
4. Click **Save payment**. The button label changes to **Uploading receipt…** then **Recording payment…**. A success toast confirms, the form closes, the list refreshes.
5. Expect a new row with the amount + gold **Manual** badge + amber **Awaiting finance review** badge + a **View receipt** link (opens the document in a new tab via Phase 5's presigned GET).
6. Try to submit without choosing a receipt → blocked client-side with "Please choose a receipt file before saving."
7. Try to submit with amount `0` or `abc` → blocked with "Please enter an amount greater than zero."

**Confirm / Reject (finance-only):**

1. Sign in as FINANCE / OWNER / ADMIN. Open the case. Open the Payments tab.
2. On any PENDING row you should see two buttons: navy **Confirm** + outline rose **Reject**. (Non-finance staff see the badge but no buttons.)
3. Click **Confirm**. Toast: "Payment confirmed." Row refreshes — badge flips to green **Confirmed**, with "Confirmed by {your name} · {today}" below the amount.
4. On a fresh PENDING row, click **Reject**. An inline reason field opens below the row.
5. Try to submit with blank reason → blocked with "Please write a short reason for the rejection."
6. Type a reason (e.g. "Receipt amount doesn't match the deposit."), click **Reject payment**. Toast: "Payment rejected." Row refreshes — badge flips to rose **Rejected**, with the reason rendered in italic underneath.
7. Try to Confirm or Reject the same row again → backend returns 409, toast says "This payment was already reviewed by someone else.", list refreshes.

**Receipt view:**

1. On any row with a **View receipt** link, click it. A new tab opens to a short-lived presigned R2 URL. The PDF/image renders.

✅ All flows above were verified passing on 2026-06-18.

---

## 7. Known limitations

- **Stripe is in TEST mode.** No real money moves. Every link is a Stripe sandbox link. Real-money cutover = swap `STRIPE_SECRET_KEY` to `sk_live_…` and `STRIPE_WEBHOOK_SECRET` to the live webhook secret in Railway. No code change.
- **Clients cannot pay or upload receipts from their own portal yet.** Staff create the Stripe link and send it manually (WhatsApp / email) to the client; staff also record manual payments and upload the receipt on the client's behalf. The `/portal/*` surface from Phase 7 does NOT yet expose payments. **A client-portal payments phase is deferred to a future PR** — see "Deferred" note at the bottom.
- **Retry-after-upload-failure on a manual payment can leave an orphan receipt document.** The flow is `uploadCaseDocument` → `POST /payments/case/:caseId/manual`. If the upload succeeds but the payment-record call fails (network blip, validation regression), the file is on R2 and the Document row exists, but no Payment row references it. Rare; not corrupting. A periodic cleanup of `documents` rows that aren't referenced by any Payment AND were uploaded `category = NULL` (or similar marker) could close this — not built today. In practice, staff retry the flow and a second receipt gets uploaded; the orphan stays attached to the case.
- **No refund flow in-app.** Refunds must be issued from the Stripe Dashboard. The Payment row in our DB will keep `status: 'succeeded'` even after a Stripe-side refund. Out of scope for this phase.
- **No installment plans.** Original roadmap mentioned them; not built. Stripe Subscriptions or multiple Payment Links could implement them later.
- **🔴 Railway Postgres has NO database backups configured.** This is a real gap before handling real client payment data. Backups require the Railway Pro plan (~US$20/mo at time of writing); Point-in-Time Recovery is not enabled. If the database is corrupted or accidentally truncated, **there is currently no way to recover**. Before flipping Stripe to live mode and processing actual money, upgrade to Pro and turn on PITR. Treat this as a blocker, not a nice-to-have.
- **No PCI scope concern.** Card data never touches Sorena — Stripe's hosted page handles all PAN/CVV. We only ever see `paymentIntent.id`, amount, currency, and metadata. Documenting this so it's clear nobody needs to chase compliance for stored card numbers.
- **Confirm has no optional-note UI yet.** The backend's `VerifyPaymentDto` supports `note?`, but the frontend Confirm button fires immediately with no prompt. If finance want to leave a confirm comment, a small "Add note" affordance can be added later. Reject already has a required-reason inline form.
- **No batch verification.** Finance reviews payments one at a time. If volume grows, a "verify queue" page (list of PENDING payments across all cases, with bulk actions) would help — not built today.
- **`Payment.verifiedById` has no FK constraint.** It's a plain `String?` per the `CrmEvent.actorId` convention, to avoid editing the User model. Deleting a staff user does NOT cascade or null this field; if the verifier is later deleted, `verifiedByName` resolves to `null` and the UI silently shows "Confirmed" / "Rejected" without an attribution name. The audit log's `actorNameSnapshot` still holds the at-the-time name, so the historical attribution isn't lost — just not surfaced in the Payments list.

---

## 8. How a future developer would extend this

- **Switch Stripe to live mode (go-live checklist):**
  1. ✅ Confirm Railway Postgres backups are enabled (Pro plan + PITR). **Do this first.**
  2. In Stripe Dashboard, register a new webhook against the live mode pointing to `[prod webhook URL]` and listen for `payment_intent.succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the new signing secret.
  3. In Railway → SorenaVisaPlatform → Variables, update `STRIPE_SECRET_KEY = sk_live_…` and `STRIPE_WEBHOOK_SECRET = whsec_…`.
  4. Trigger a no-op redeploy (or wait for the next push). The backend reads `process.env.STRIPE_SECRET_KEY` on cold boot.
  5. Sanity: create a $1 consultation link via the staff UI, pay it with a real card you control, confirm the Payment row lands, Confirm it from a FINANCE account, verify the Stripe Dashboard shows the charge.
- **Build client-portal payments (the deferred phase below).** The client portal already mounts `<CaseDocumentsPanel canDelete={false} />`. Add a similar `<ClientPaymentsPanel />` at `/portal/case/payments` that calls a NEW client-facing endpoint `GET /portal/me/payments` (mirror the existing `/portal/me/case` pattern — derive case from the JWT, role-gate `LEAD`/`STUDENT`, whitelisted shape). For client-side manual-payment upload, expose `POST /portal/me/payments/manual` that uses the SAME receipt validation logic from `recordManualPayment`. Client-recorded payments still land PENDING — finance still has to Confirm them.
- **Surface the "Add note" affordance on Confirm.** The `VerifyPaymentDto` already supports `note?`. Mirror the Reject inline-expand pattern in `CasePaymentsPanel`: clicking Confirm opens a small inline note field with Cancel / Confirm. Keep the immediate-fire path as an alternative for power users.
- **Cleanup orphan receipt documents.** A cron job (or `payments` module method) that runs nightly: find documents in the case-receipts-only set that aren't referenced by any Payment AND are older than 24h, delete them from R2 + the `documents` table. Audit each cleanup.
- **In-app refunds.** Add a `POST /payments/:paymentId/refund` route, FINANCE-only, that calls Stripe's refund API and updates the Payment row's status. Audit the refund. Add a "Refund" button on CONFIRMED Stripe rows in the staff UI.
- **Finance verification queue page.** New route `/staff/payments/pending` — lists every PENDING payment across the platform with case context + Confirm/Reject inline. Helps when volume grows beyond "open each case and review there."
- **Move `CaseDocumentsPanel` to the shared `case-documents` helper.** When you're next touching `CaseDocumentsPanel`, switch its inline 3-step upload to `uploadCaseDocument(caseId, file)` from `frontend/src/lib/case-documents.ts` (already created in d981862 and used by the Payments tab). Removes the duplicate bytes-to-R2 sequence. Don't do it as a standalone PR — wait until that file is being touched anyway, to keep the diff scope tight.

---

## 9. Security layers applied

| Layer | Applied? | Where |
|-------|----------|-------|
| **2. Row-level / role-based access** | ✅ | (a) Listing + manual record + link creation: `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('OWNER','SUPER_ADMIN','ADMIN','LIA','CONSULTANT','SUPPORT','FINANCE')` — the full staff list. (b) **Confirm + Reject: narrower** `@Roles('OWNER','ADMIN','FINANCE')` — verification is a privileged finance action; SUPPORT/CONSULTANT/LIA can see PENDING badges but get no buttons. (c) The frontend mirrors this: `VERIFICATION_ROLES = new Set(['FINANCE','OWNER','ADMIN'])` from `useStaff()` gates the buttons too — but the BACKEND is the actual gate. (d) **Cross-tenant guard on manual receipts:** `recordManualPayment` validates `receipt.caseId === caseId` and `receipt.status === 'UPLOADED'`. A caller cannot attach another case's document — receipt missing, foreign, or still half-uploaded → BadRequest, no Payment row written. |
| **3. Secrets in env vars, never in code** | ✅ | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` live only in Railway Variables. Code reads `process.env.STRIPE_SECRET_KEY` on cold boot. Frontend has no Stripe key. **Open follow-up:** add the two var names with empty values to `backend/.env.example` so a fresh `git clone` documents them. |
| **4. HTTPS only** | ✅ | Railway + Vercel + Stripe all serve HTTPS by default. Webhook URL is HTTPS — Stripe refuses to register http. |
| **5. Rate limiting** | ✅ partial | Global `@nestjs/throttler` covers most routes. The webhook is intentionally `@SkipThrottle()` — Stripe retries with exponential backoff over ~3 days and a 429 would risk losing payment events; Stripe-signature verification is the access control there. |
| **6. Audit log of admin actions** | ✅ | Three eventTypes added: `PAYMENT_RECORDED_MANUAL` (manual record path), `PAYMENT_VERIFICATION_CONFIRMED` (confirm path), `PAYMENT_VERIFICATION_REJECTED` (reject path). Each audit row carries `userId` + `actorNameSnapshot` + `actorRoleSnapshot` + structured `newValue` (caseId, leadId, paymentType, amount, currency, hasNote bool, transition). All written inside the SAME `$transaction` as the Payment write/update — if the audit fails, the payment change rolls back too. |
| **7. File upload safety + signed URLs** | ✅ | Inherited end-to-end from Phase 5. Receipts are stored via `request-upload` → presigned PUT → `confirm`; the bucket is private; downloads via short-lived presigned GET. MIME whitelist (PDF/JPG/PNG) + 15 MB cap enforced both client- and server-side. |
| **9. Input validation** | ✅ | All DTOs use `class-validator` + the global `ValidationPipe` (`whitelist + forbidNonWhitelisted + transform`). `RecordManualPaymentDto` requires integer cents ≥ 1, optional 3-letter currency code, optional note ≤ 500, required receiptDocumentId. `CreateCaseConsultationLinkDto` validates against the imported `CONSULTATION_TYPES` constant. `VerifyPaymentDto` allows an optional note ≤ 500. `RejectPaymentDto` requires a non-empty note ≤ 500. The reject service ALSO re-checks `note.trim()` server-side — DTO + service defence-in-depth. |

**Whitelist-as-design.** `listPaymentsForCase`'s `select` is explicit field picking — `metadata`, `stripePaymentIntentId`, `leadId`, raw `caseId` are deliberately omitted. A future column on `Payment` cannot leak unless the picker is updated. Same principle as Phase 7's portal whitelist.

**Idempotency.** The webhook write keys on `stripePaymentIntentId @unique` — Stripe retries land as P2002 and short-circuit the rest of the handler (no double email, no double subscription activation, no double `assignLiaToCase`). The synthetic `manual_<uuid>` ids for manual rows can never collide with real `pi_…` ids.

**Transition guard.** `confirmPayment` and `rejectPayment` both refuse to act on rows that aren't `PENDING` — returns 409 Conflict. The frontend handles this calmly via the "already reviewed" toast + refresh. No double-confirm or confirm-after-reject is possible.

---

## 10. Rollback instructions

The Payments feature shipped as six commits, in order. Roll back in **reverse order** (newest first). Each commit is a separate `git revert` then push — Railway/Vercel auto-deploy.

1. **`d981862`** — Phase 6.5 frontend (verification UI). Pure UX rollback. Reverting hides Confirm/Reject buttons + status badges + receipt-required validation from the manual form. The backend continues to enforce receipt-required and PENDING-by-default, so a stale build of the Payments tab would fail to submit a manual payment until staff re-deploy this commit. Tolerable but visible.
   ```bash
   git revert d981862 && git push origin main
   ```
2. **`003e634`** — Phase 6.5 backend (verification endpoints + receipt-required + Stripe lands PENDING). After this revert, manual payments will once again accept no receipt, the confirm/reject endpoints 404, and the webhook stops writing `verificationStatus`. The DB columns stay (they're additive, nullable, defaulted — harmless to leave in place).
   ```bash
   git revert 003e634 && git push origin main
   ```
3. **`e3a3760`** — Stripe `product_data.description` bug fix. **DO NOT revert this commit.** Reverting re-introduces the bug that makes consultation-link creation throw "Received unknown parameter: product_data[description]" from the Stripe SDK. This commit fixes a real bug; there's no scenario where reverting it is correct.
4. **`825c65b`** — Phase 6 frontend (Payments tab). Removes the tab from the case detail page; staff lose UI access to listing + link creation + manual record. The backend routes stay live (other clients could still call them).
   ```bash
   git revert 825c65b && git push origin main
   ```
5. **`dbdf1b5`** — case-keyed consultation-link route. Removes `POST /payments/case/:caseId/consultation-link`. The legacy leadId-keyed route still exists.
   ```bash
   git revert dbdf1b5 && git push origin main
   ```
6. **`4bf8425`** — list payments + manual mark-paid + CONSULTATION_TYPES DTO. After this revert, the GET listing and POST manual routes 404. **Do not revert past this** without also rolling back the Phase 7 portal's reuse of `CaseDocumentsPanel` (that file is now shared).
   ```bash
   git revert 4bf8425 && git push origin main
   ```

**Database state — schema columns can stay.** The Phase 6.5 columns and the `PaymentVerificationStatus` enum are additive, nullable (except `verificationStatus` which has a default), and unreferenced by any code post-rollback. Leaving them is harmless and saves a manual SQL re-application if the rollback is ever reversed. If you genuinely want to remove them (e.g. you're truly walking away from the feature), in the Railway Data tab:

```sql
ALTER TABLE "payments" DROP COLUMN "verificationStatus", DROP COLUMN "verifiedById", DROP COLUMN "verifiedAt", DROP COLUMN "verificationNote", DROP COLUMN "receiptDocumentId";
```

```sql
DROP TYPE "PaymentVerificationStatus";
```

**Stripe state — leave it.** Don't rotate `STRIPE_SECRET_KEY` on rollback unless you suspect compromise — rotating breaks any payment links already shared with prospects. The webhook registration in the Stripe Dashboard can stay; the endpoint will keep responding 200 with the Stripe-signature check passing, just without recording rows (post-revert).

**Emergency stop (kill payment creation without redeploying):** delete `STRIPE_SECRET_KEY` from Railway. The backend's `assertConfigured()` guard returns BadRequest on every link-creation call. Existing Stripe Payment Links continue to work because they live on Stripe's side. Manual payment recording still works (it doesn't call Stripe).

---

## Deferred — future phase

**Client-portal payments (not built).** Clients sign in to `/portal/case` (Phase 7) and see their case state + documents, but **not their payments**. They cannot view what they've paid, see what's outstanding, click "Pay now" against a Sorena-issued link, or upload their own bank-transfer proof. Today the workflow is staff-driven: staff create the Stripe link and message it; staff record manual payments and upload the receipt on the client's behalf.

A future phase should add:
- `GET /portal/me/payments` (mirror of `/portal/me/case` — JWT subject → lead → case → payments, whitelisted shape, role-gated `LEAD`/`STUDENT`).
- A `<ClientPaymentsPanel />` on `/portal/case/payments` showing what they've paid + what's PENDING from their side.
- "Pay now" button against open consultation/account-opening charges that opens the existing Stripe link.
- Client-side manual-payment proof upload (reuses the Phase 5 upload helper from `frontend/src/lib/case-documents.ts` — already extracted). Client-recorded payments still land PENDING; finance still has to Confirm them.

The shared `CaseDocumentsPanel`'s `canDelete: boolean` prop is the template: the same Payments panel can be staff-vs-client-aware via a `canVerify: boolean` prop (false for clients, true for finance), and the same backend pattern (`/portal/me/*` for client-side, `/payments/case/:caseId` for staff) keeps the surfaces cleanly separate.

---

## Appendix A — commit history for this phase

| Commit | What it did |
|--------|-------------|
| `4bf8425` | **Phase 6 step 1** — `listPaymentsForCase` + `recordManualPayment` service methods, `GET /payments/case/:caseId` + `POST /payments/case/:caseId/manual` routes, `RecordManualPaymentDto`, `CONSULTATION_TYPES` constant in `create-payment-link.dto.ts`, 9 unit tests. |
| `dbdf1b5` | **Phase 6 step 2** — case-keyed consultation-link convenience route `POST /payments/case/:caseId/consultation-link` + service method `createConsultationLinkForCase` + `CreateCaseConsultationLinkDto`, 4 unit tests. |
| `825c65b` | **Phase 6 step 3** — staff Payments tab UI: `CasePaymentsPanel.tsx`, tab wiring in `CaseTabs.tsx` + `CaseDetailClient.tsx`, English + Persian i18n. |
| `e3a3760` | **Phase 6 bug fix** — removed `description` from `product_data` in `stripe.prices.create` to resolve "Received unknown parameter" error. **Do not re-add the field.** |
| `003e634` | **Phase 6.5 backend** — `PaymentVerificationStatus` enum + 5 columns on `Payment` (applied manually); `recordManualPayment` requires receipt (cross-tenant guard); `confirmPayment` + `rejectPayment` service methods + routes (`POST /payments/:paymentId/confirm` + `/reject`, FINANCE/OWNER/ADMIN); webhook writes `verificationStatus: 'PENDING'`; `listPaymentsForCase` returns verification fields + batched `verifiedByName`; new DTOs + 30 unit tests including a focused webhook-shape spec. |
| `d981862` | **Phase 6.5 frontend** — receipt picker in manual form (2-stage upload→record), status badges (PENDING/CONFIRMED/REJECTED), Confirm/Reject buttons gated by `useStaff()` role, inline reject-reason form, "View receipt" link, calm 409 handling; shared upload/view helper at `frontend/src/lib/case-documents.ts`; English + Persian i18n. |

---

## Appendix B — Historical: incident note (2026-04-27)

Preserved from the original Phase 6 doc. Still relevant operationally.

The original Stripe live secret key was briefly exposed in a screenshot during a debugging session. The key was rotated within ~15 minutes via Stripe Dashboard → API keys → Rotate key → "Now". Stripe Payments and Security history were reviewed for the affected window — no unauthorized activity. The new key was placed directly into Railway without ever appearing in chat, screenshots, or commits.

**Going forward: never screenshot Railway Variables, Stripe API keys, or any page that may render a secret value.**

---

## Appendix C — Historical: Prisma on Alpine debug log (2026-04-27)

Preserved from the original Phase 6 doc. The Dockerfile + schema fixes documented here remain in effect; understand them before changing build infrastructure.

After the initial Phase 6 deploy, the backend crashed on startup with:

```
PrismaClientInitializationError: 'PrismaClient' needs to be constructed with a non-empty, valid 'PrismaClientOptions'
```

This error was misleading. The real cause was Prisma binary mismatch on Alpine Linux, not options. Two fixes were required together.

**Fix A — `schema.prisma` generator block must include explicit `binaryTargets`:**

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}
```

Without this, `prisma generate` only emits binaries for the host that ran it (glibc on dev machines), and Alpine's musl libc cannot execute them at runtime.

**Fix B — Dockerfile must install openssl in both build and production stages:**

```dockerfile
RUN apk add --no-cache openssl
```

Alpine ships without openssl by default; Prisma's query engine links against it.

Also discovered: the previous Dockerfile attempted to copy `node_modules/.prisma` and `node_modules/@prisma` from the builder stage to the production stage. This is fragile — the canonical pattern is to install prod deps fresh and run `npx prisma generate` again in the production stage. The current Dockerfile follows this pattern.

**Prisma version note:** Prisma 7.7.0 does NOT accept `datasources` or `datasourceUrl` as constructor options in TypeScript — both fail with `TS2353`. The correct pattern for v7 is bare `super()` and let Prisma read `DATABASE_URL` from `process.env` directly.
