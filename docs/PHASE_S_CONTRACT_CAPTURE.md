# PHASE-S — Contract capture (signed PDF + visa type)

When a DocuSign engagement envelope reaches full completion, the webhook now (A)
downloads the flattened signed PDF and stores it as a case Document, and (B)
reads the LIA's `visaType` checkbox selection onto the case. Two other requested
fields — **client address and phone — are deferred**: they are not contract-
extractable (see §7).

## 1. What this PR does

- **A — signed PDF → case:** on envelope `completed`/SIGNED, the webhook downloads
  the combined signed PDF from DocuSign (`getDocument('combined')`), stores it in
  R2, and creates a `Document` row (`category: 'signed_contract'`, `status: UPLOADED`)
  on the case. It then appears in the case's documents list and is downloadable
  via the existing signed-URL route — like any other case doc.
- **B — visa type → case:** the webhook reads the LIA's `visaType` checkbox-group
  selection (via `listRecipients` + `include_tabs`) and saves it to a new
  `Case.visaType` (additive, nullable). Surfaced read-only on the case overview.
- Both steps are **idempotent** and **best-effort** (never fail the webhook).

## 2. Trigger point & idempotency

`ContractsService.handleWebhook` already detects SIGNED (DocuSign only reports
envelope `completed` when ALL recipients have signed). A new
`captureSignedArtifacts(caseId, envelopeId)` runs inside that SIGNED branch:

- **PDF idempotency:** skips if a `Document` with `category='signed_contract'`
  already exists for the case; the deterministic, unique `r2Key`
  (`signed-contracts/<caseId>/<envelopeId>.pdf`) is a race backstop (P2002 →
  treated as already-stored).
- **visaType idempotency:** skips if `Case.visaType` is already set (no re-read,
  no overwrite).
- **Never-throws:** each step is wrapped; a DocuSign/R2 failure logs an error and
  leaves the rest of the webhook (status updates, auto-assign) succeeding.

## 3. Data model (additive)

`Case` gains one nullable column (migration `20260721120000_case_visa_type`):

| Column | Type | Meaning |
|---|---|---|
| `visaType` | `TEXT` (nullable) | the LIA's selected visa-type checkbox label from the signed contract; NULL until fully signed. Free-text (the checkbox's `tabLabel`), not an enum, so template wording changes don't need a migration. |

The signed PDF reuses the **existing** `Document` model (`{ caseId, uploaderId,
r2Key @unique, originalName, mimeType, sizeBytes, status, category }`) — no schema
change. The system-stored PDF is attributed to the case **LIA** (`case.liaId`,
guaranteed set at completion; falls back to `ownerId`).

## 4. Files changed

- **Migration/schema:** `prisma/schema.prisma` (`Case.visaType`) +
  `prisma/migrations/20260721120000_case_visa_type/migration.sql`.
- **Backend:** `contracts/docusign.service.ts` (new `getCombinedDocument`,
  `getSelectedVisaType`), `contracts/contracts.service.ts` (`captureSignedArtifacts`
  + SIGNED-branch call + `signed_contract` category const + R2 dep),
  `contracts/contracts.module.ts` (import `R2Module`), `staff/cases/staff-cases.service.ts`
  (emit `visaType` on the detail response).
- **Frontend:** `components/staff/cases/detail/types.ts` (`CaseDetail.visaType`),
  `.../CaseOverviewTab.tsx` (read-only "Visa type" row).
- **Test (gitignored):** `backend/scripts/test-contract-capture.ts`.

## 5. Configuration

- Uses the **existing DocuSign JWT auth** and **existing R2** (no new env). The
  signed PDF is fetched with the same `EnvelopesApi` as every other call.
- **Additive migration** applied by the pre-deploy `migrate:deploy`.

## 6. How to test

`backend/scripts/test-contract-capture.ts` — **14/14 PASS** (run from `backend/`).
Uses a mocked DocuSign (`getCombinedDocument` / `getSelectedVisaType`) + mocked R2
because there is no live completed envelope to hit:

- First completion: a `signed_contract` `Document` row is created (`UPLOADED`,
  correct `r2Key`/`sizeBytes`, attributed to the LIA), R2 `putObject` called once,
  PDF downloaded once, `Case.visaType` set, and both audit events written.
- It appears in the case's `UPLOADED` documents (so it shows in the Documents tab).
- **Re-fire the same webhook:** still exactly one `Document` (no duplicate, no
  re-download/re-put, no second audit); `visaType` unchanged (not re-read).

`nest build` + frontend `tsc` clean.

**Not runtime-verified against a live envelope** (none completed in demo): the
tab-parsing in `getSelectedVisaType` (reading the LIA's selected checkbox) is
covered only via the mock — see §7.

## 7. Known limitations / deferred

- **Address + phone are NOT captured — deferred, by decision.** They are not
  DocuSign fields (static printed `Address:`/`Phone:` lines on page 1, no client
  tabs there) and so can't be read from the contract. Paths forward:
  - **Address:** add a client Address text tab to the template (part of the
    production-template rebuild) OR collect it via a client-portal / case intake
    step. No structured home exists today.
  - **Phone:** `Contact.phone` already exists on the case's client contact (often
    empty) — needs a *collection* point, not contract extraction.
- **visaType value = the checkbox `tabLabel`.** For human-readable visa names the
  template's 11 checkboxes must have their `tabLabel` set to the visa type. The
  current demo template may use auto labels; set them meaningfully during the
  production-template rebuild. The capture mechanism itself is label-agnostic.
- **Live tab-read unverified** — no completed demo envelope existed; verify
  `getSelectedVisaType` against the first real completion (log line
  `captured visaType="…"`).
- **PDF store is best-effort** — a DocuSign/R2 failure logs but doesn't fail the
  webhook (so status updates still land). Because DocuSign fires `completed` once,
  a persistent failure means the PDF isn't stored until the webhook is re-fired
  (idempotent, so safe to replay). A scheduled backfill could be added later.

## 8. How to extend

- **Backfill / manual re-capture:** call `captureSignedArtifacts(caseId, envelopeId)`
  from an admin action for any SIGNED contract whose PDF/visaType didn't land.
- **Richer visa-type mapping:** if the template exposes a group value instead of
  per-box labels, extend `getSelectedVisaType` to read the group's selected value.

## 9. Security

- **Webhook stays HMAC-verified** (`DocusignWebhookGuard`) — no new unauthenticated
  surface. The capture runs inside the already-guarded handler.
- **Signed PDF is private** — stored under an R2 key, never exposed directly; it's
  read only through the existing **signed-URL** download route
  (`GET /cases/:caseId/documents/:id/download-url`), which is access-controlled
  exactly like every other case document (`r2Key` is never returned by the list).
- **Audited:** `CONTRACT_SIGNED_PDF_STORED` and `CONTRACT_VISA_TYPE_CAPTURED` audit
  rows on the case, with the envelope id.
- **No client-trusted input:** the PDF bytes and visaType come from DocuSign over
  authenticated JWT calls, not from the webhook body.

## 10. Rollback procedure

- **Code:** revert the commit — the webhook stops storing the PDF / capturing
  visaType; all prior behaviour (status updates, auto-assign) is unchanged. Any
  already-stored `signed_contract` Documents remain valid and downloadable.
- **Data/schema:** the migration is additive — to fully roll back,
  `ALTER TABLE "cases" DROP COLUMN "visaType";`. Stored R2 objects + Document rows
  are unaffected by the column drop (the PDF feature doesn't use `visaType`).
  Frontend/backend roll back independently.
