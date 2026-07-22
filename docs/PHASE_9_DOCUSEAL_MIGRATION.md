# Phase 9 — DocuSign → DocuSeal Migration

End-of-phase handover for replacing DocuSign with self-hosted DocuSeal as the
engagement-contract e-signature provider. Built, verified against the live
DocuSeal instance, and deployed to production.

**Date:** 2026-07-22
**Commits (this phase):**
- `5678be1` — feat(contracts): add DocuSeal provider and make it the active contract flow
- `8dc5642` — fix(docuseal): match live template field names + add webhook harness test
- `ac45c6e` — feat(docuseal): accept DocuSeal HMAC signature as a webhook auth fallback

---

## 1. What this phase does

We replaced **DocuSign** (paid — ~US$50/mo minimum for production sending, demo-only
otherwise) with **self-hosted DocuSeal** (free, open-source) as the provider that
sends and collects signatures on the engagement contract. The client → LIA →
Director signing flow, the captured visa type, and the stored signed PDF all work
the same way. Crucially, **none of the post-signature business logic changed**:
the same code still marks the contract SIGNED, creates the `ENG-` engagement
invoice, promotes the client LEAD → STUDENT, and auto-assigns LIA/Admission/
Finance. The provider is selected by a single env var (`CONTRACT_PROVIDER`), and
the entire DocuSign code path is retained untouched for instant rollback.

## 2. Files created or changed

Pulled from `git diff --stat 452deb3 ac45c6e`. **10 files, +1228 / −99.**

**Created**
- `backend/src/contracts/docuseal.service.ts` — DocuSeal API client (`createSubmission`,
  `getSubmission`, `downloadCompletedPdf`, `extractVisaType`) + the pure
  `buildEngagementSubmitters` builder, `docusealSubmitterStatus` map, the
  `DOCUSEAL_ROLE_*` party constants, and `VISA_CHECKBOX_FIELDS`. `5678be1`, field
  names corrected in `8dc5642`.
- `backend/src/contracts/docuseal.service.spec.ts` — unit tests for the builder,
  status map, and visaType extractor. `5678be1`, updated `8dc5642`.
- `backend/src/contracts/docuseal-webhook.guard.ts` — the webhook auth guard.
  Secret-header mode in `5678be1`; HMAC fallback added in `ac45c6e`.
- `backend/src/contracts/docuseal-webhook.guard.spec.ts` — guard unit tests
  (Secret + HMAC). `ac45c6e`.
- `backend/src/contracts/contracts.docuseal-webhook.spec.ts` — harness test that
  drives `handleDocusealWebhook` end-to-end (mocked deps). `8dc5642`.
- `backend/prisma/migrations/20260722120000_add_docuseal_submission_id/migration.sql`
  — the `Contract.docusealSubmissionId` migration. `5678be1`.

**Changed**
- `backend/prisma/schema.prisma` — added `Contract.docusealSubmissionId`. `5678be1`.
- `backend/src/contracts/contracts.controller.ts` — `create()` now branches on
  `CONTRACT_PROVIDER`; added `POST /contracts/docuseal/webhook`. `5678be1`.
- `backend/src/contracts/contracts.module.ts` — registered `DocusealService` +
  `DocusealWebhookGuard`. `5678be1`.
- `backend/src/contracts/contracts.service.ts` — extracted the shared
  `prepareEngagementSend` prep + the provider-agnostic `storeSignedContractPdf` /
  `storeCaseVisaType` helpers, and added `createContractViaDocuseal` +
  `handleDocusealWebhook`. **The DocuSign `createContract` / `handleWebhook`
  remain intact.** `5678be1`.

**Untouched (kept for rollback):** `docusign.service.ts`, `docusign-webhook.guard.ts`.

The controller provider switch (live):

```ts
// PR-DOCUSEAL — provider switch. DocuSeal is the active default; set
// CONTRACT_PROVIDER=docusign to roll back to the (intact) DocuSign flow with
// no code change.
const provider = (process.env.CONTRACT_PROVIDER ?? 'docuseal').toLowerCase();
return provider === 'docusign'
  ? this.contractsService.createContract(dto, actor)
  : this.contractsService.createContractViaDocuseal(dto, actor);
```

## 3. Database tables / columns added

- **`Contract.docusealSubmissionId String? @unique`** — the DocuSeal submission id
  the completion webhook keys on. Nullable + unique; the DocuSign
  `docusignEnvelopeId` column is untouched.
- **Migration:** `20260722120000_add_docuseal_submission_id` (2026-07-22).
  Applied to production via the deploy `migrate:deploy` step (verified: column
  present, migration recorded as finished).

```sql
ALTER TABLE "contracts" ADD COLUMN "docusealSubmissionId" TEXT;
CREATE UNIQUE INDEX "contracts_docusealSubmissionId_key" ON "contracts"("docusealSubmissionId");
```

## 4. Environment variables added (names only)

Set on the Railway **`SorenaVisaPlatform`** (backend) service:

- `CONTRACT_PROVIDER` — `docuseal` (active) | `docusign` (rollback)
- `DOCUSEAL_BASE_URL`
- `DOCUSEAL_API_TOKEN` (secret)
- `DOCUSEAL_TEMPLATE_ID`
- `DOCUSEAL_WEBHOOK_SECRET` (secret — used for BOTH the secret-header and HMAC checks)

(The existing `CONTRACT_DIRECTOR_EMAIL` / `CONTRACT_DIRECTOR_NAME` are reused for
the Director signer and are unchanged.)

## 5. Third-party services connected

- **DocuSeal** — self-hosted on Railway (service name **`docuseal`**), reachable at
  its Railway public domain (`https://docuseal-production-6ec5.up.railway.app`);
  the admin console is at that same domain. Engagement template is **id 1**
  ("engagement-letter-v1") with parties **Client / LIA / Director**.
- **Email:** DocuSeal sends the signing-request emails using the **existing Resend
  SMTP** credentials (same provider the platform already uses), so signer emails
  come from the Sorena domain rather than a DocuSeal address.

## 6. How to test it works

1. Create a **test lead** (throwaway email you control) and make sure it passes the
   execution gate (`executionAllowed=true`, `hardStopFlag=false`).
2. **Convert it to a case** — `/staff/leads/[id]` → **Create case**.
3. On the case, click **Send engagement contract**. (With `CONTRACT_PROVIDER=docuseal`
   this calls `createContractViaDocuseal`.)
4. **Confirm all three emails arrive** in signing order **Client → LIA → Director**
   (DocuSeal emails the next party only after the previous one completes — `order:
   'preserved'`). They come from DocuSeal via Resend.
5. **Sign as each party.** As the LIA, tick one of the 11 visa-type checkboxes.
6. **Confirm the webhook fires** — in Railway logs for `SorenaVisaPlatform`, look for
   `DocusealWebhookGuard` (should **accept**, not reject) and
   `handleDocusealWebhook: submission … completed → contract … SIGNED + downstream run`.
7. **Confirm the outcome:** the case's contract shows **SIGNED**, `Case.visaType` is
   populated with the ticked checkbox name(s), the signed PDF is on the case, and the
   **$200 engagement invoice** appears in the client portal (`/student` tile +
   `/student/payments`) with a working **Pay now**.

**Automated checks already green:** `docuseal.service.spec` (builder/fields/visaType),
`contracts.docuseal-webhook.spec` (SIGNED + visaType + PDF + invoice + promotion all
fire), `docuseal-webhook.guard.spec` (Secret + HMAC). A live send to `/api/submissions`
returned HTTP 200 with submitters ordered Client → LIA → Director (test submission
deleted). The one thing only a human can do is the browser signing in step 5.

## 7. Known limitations

- **Passport No doesn't auto-carry.** The template has two separate `Passport No`
  fields (pages 1 and 2) that don't share a field name, so a value entered on one
  page isn't mirrored to the other — the client re-enters it. (The same is true for
  the second `Full Name`, but that one IS prefilled from our side, so it's populated.)
  Fix later by giving the paired fields the same name in the DocuSeal template.
- **Only `Full Name`, `Email` (Client) and `Full Name`, `IAA Licence No` (LIA) are
  pre-filled.** Address / Phone / Passport are entered by the client at signing.
- **DocuSign path is retained for rollback but is now untested against a DocuSeal-era
  database going forward** — it still compiles and is unchanged, but no live DocuSign
  send has been exercised since the migration. Treat a rollback as "probably works,
  verify on use."
- **visaType is free text.** Multiple ticked checkboxes are stored comma-joined into
  `Case.visaType`.

## 8. How a future developer would extend this

- **Switch or add a provider:** the branch is in
  `backend/src/contracts/contracts.controller.ts` (`create()`), keyed on
  `process.env.CONTRACT_PROVIDER`. Shared send-prep lives in
  `ContractsService.prepareEngagementSend`.
- **Add / change a signer role:** edit the `DOCUSEAL_ROLE_*` constants and
  `buildEngagementSubmitters` in `backend/src/contracts/docuseal.service.ts` (roles
  must match the DocuSeal template's party names exactly), plus the signer-row writes
  in `ContractsService.createContractViaDocuseal`.
- **Map visaType checkbox names:** the `VISA_CHECKBOX_FIELDS` array in
  `docuseal.service.ts` — must match the template's checkbox field names verbatim;
  `extractVisaType` reads the checked ones.
- **Prefill more fields:** add keys to the submitter `values` maps in
  `buildEngagementSubmitters` (keyed by the exact template field name, e.g.
  `'Full Name'`, `'Email'`, `'IAA Licence No'`).
- **Handle more webhook events:** `ContractsService.handleDocusealWebhook` — it
  currently acts on `form.completed` / `submission.completed`; branch on
  `payload.event_type` there for others (e.g. declined/expired).

## 9. Security layers applied

- **Webhook guard is fail-closed with TWO verification modes** (`DocusealWebhookGuard`),
  accepting the request if EITHER passes, else 401:
  1. **Secret header** — `X-Sorena-Webhook-Secret` constant-time-compared to
     `DOCUSEAL_WEBHOOK_SECRET`.
  2. **Native HMAC** — `X-Docuseal-Signature: "<ts>.<hex>"`, verified as
     `HMAC-SHA256(secret, "<ts>.<raw body>")` with a **±300s timestamp tolerance**
     and a **`crypto.timingSafeEqual`** hex-digest compare (over `req.rawBody`).
  Rejections log a mode-specific warning (secret mismatch vs HMAC invalid vs neither
  present) for fast debugging.
- **Defence in depth:** even after the guard, `handleDocusealWebhook` **re-fetches the
  submission from the DocuSeal API** (authoritative) before acting — a leaked secret
  alone can't fabricate a completed submission.
- **Secrets only in Railway env vars** — no tokens/secrets in code or git.
- **Audit logging covers the contract lifecycle:** `CONTRACT_SENT` (with
  `provider: 'docuseal'` + `submissionId`) at send, and on completion
  `CONTRACT_SIGNED_PDF_STORED`, `CONTRACT_VISA_TYPE_CAPTURED`, `INVOICE_CREATED_ON_SIGN`,
  and `CLIENT_PROMOTED_TO_STUDENT`. The SIGNED state transition is written to the
  `Contract` row (status + `signedAt`) and the per-party `ContractSigner` rows
  (status + `signedAt`).

## 10. Rollback instructions

1. In Railway (`SorenaVisaPlatform` service), set **`CONTRACT_PROVIDER=docusign`**.
2. Redeploy (or let the env change trigger a redeploy).

This reverts **new** contract sends to the (intact) DocuSign path only. It does **not**
retroactively affect contracts already sent/completed via DocuSeal — those rows keep
their `docusealSubmissionId`, SIGNED status, stored PDF, captured visaType, and
invoice. No migration rollback is needed (the `docusealSubmissionId` column is nullable
and harmless to the DocuSign path). Note the DocuSign live send is untested post-
migration (see §7), so verify a real send after rolling back.
