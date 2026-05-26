# PR-LIA-7 — INZ submission lifecycle (submit / edit / revert + client email)

A new stage in the case workflow. The LIA hits "Submit to INZ", captures the INZ reference + payment receipt + optional notes; the case transitions from `VISA` to a new `INZ_SUBMITTED` stage; the client gets an email confirmation; the LIA gets an edit affordance + a destructive-confirmation revert if anything was wrong.

## 1. What this PR does

Until this PR, "submit to INZ" was an out-of-system step. The LIA logged into the INZ portal, lodged the application, paid the fee, kept the receipt PDF in a folder on their own desktop. The platform had no record beyond "case is in VISA stage" and no signal to the client that anything had happened. PR-LIA-7 closes that loop.

A new `CaseStage.INZ_SUBMITTED` value sits between `VISA` and `COMPLETED`. Transitioning into it requires four things on a single multipart POST: the INZ reference number (free text up to 128 chars, anything matching the format the LIA already typed into the INZ portal — we don't parse it), a submission date (defaults to today), an optional notes textarea, and a payment-receipt file (PDF / JPEG / PNG / HEIC, max 10MB). The whole submission is a single transaction: case row gets the new stage + five new metadata columns, an `INZ_SUBMITTED` audit row gets written, and — when the case has reached the visa-side workspace — a paired `VisaCaseFileNote` is added. The client email fires fire-and-forget after the transaction commits.

Edits are in-place: the LIA can correct a typo in the reference, fix the date, or amend notes via `PATCH /cases/:id/inz-submission` without touching the receipt. Swapping the receipt requires reverting first (the spec calls this out — receipt-edit is deferred to PR-LIA-7.1). Reverts roll the case back to `VISA`, clear the five INZ columns, and write an `INZ_SUBMISSION_REVERTED` audit row with the operator's reason **encrypted** via `CryptoService` (sensitive commentary; matches PR-LIA-1's revert pattern). The receipt file is left on disk — recoverable from the audit log via its `oldValue.inzReceiptFileName` snapshot.

Receipt storage is **denormalised onto Case** (four columns: `inzReceiptFileUrl`, `inzReceiptFileName`, `inzReceiptMimeType`, `inzReceiptSizeBytes`) rather than a separate `InzSubmissionReceipt` model. One receipt per case, lifecycle bound to the submission — a new model would have been overkill. The bytes live under `./uploads/inz-receipts/<caseId>/<deterministic-name>.<ext>`, mirroring the admission upload pattern. Downloads go through the existing `/files/signed/:token` route — the LIA UI requests a download URL and the backend hands back a 5-minute JWT-signed token.

No new env vars. No new npm dependencies. One Prisma migration. Email send is best-effort — a missing SMTP config doesn't block the submission.

## 2. Files changed

Backend (new):
- `prisma/migrations/20260526220000_pr_lia_7_inz_submission/migration.sql` — `ALTER TYPE` + 7 column additions + lookup index.
- `src/cases/inz-submission/inz-submission.service.ts` — owns `submitToInz`, `editInzSubmission`, `revertInzSubmission`, `getReceiptInfo`. Handles file move from pending → final, validates stage transitions, writes audit + file note + email.
- `src/cases/inz-submission/inz-submission.controller.ts` — `@Controller('cases')`, role-gated `LIA / ADMIN / SUPER_ADMIN / OWNER`. Four routes (submit POST multipart, edit PATCH JSON, revert POST JSON, receipt-url GET).
- `src/cases/inz-submission/dto/inz-submission.dto.ts` — `SubmitToInzDto`, `EditInzSubmissionDto`, `RevertInzSubmissionDto`.

Backend (existing):
- `prisma/schema.prisma` — new `INZ_SUBMITTED` enum value, 7 columns on `Case`, `@@index([inzApplicationNumber])`.
- `src/cases/cases.module.ts` — registers `InzSubmissionService` + `InzSubmissionController`, exports the service.
- `src/notifications/notifications.service.ts` — `sendInzSubmittedToClient` matching the PR-LIA-2 best-effort pattern.
- `src/common/audit/audit.helper.ts` — three new summarizer cases (`INZ_SUBMITTED`, `INZ_SUBMISSION_EDITED`, `INZ_SUBMISSION_REVERTED`).
- `src/inz-data/inz-data.service.ts` — `case` block in the response now includes `inzApplicationNumber` + `inzSubmittedAt` so the inz-data viewer can render the "submitted" banner.

Frontend (new):
- `src/app/lia/cases/[id]/SubmitToInzButton.tsx` — multipart upload overlay.
- `src/app/lia/cases/[id]/EditInzSubmissionButton.tsx` — in-place edit overlay (text-only).
- `src/app/lia/cases/[id]/RevertInzSubmissionButton.tsx` — two-step destructive confirmation (type the case ID).
- `src/app/lia/cases/[id]/DownloadInzReceiptButton.tsx` — signed-URL receipt download, mirrors PR-LIA-5's pattern.

Frontend (existing):
- `src/app/lia/cases/[id]/page.tsx` — new `CaseDetail` fields + the `InzSubmissionPanel` (three states by stage) inserted between header and legal-flags banner. Imports the four new buttons + `CopyButton` from PR-LIA-6.
- `src/app/lia/cases/page.tsx` — queue Stage filter chips gain `INZ Submitted`.
- `src/app/lia/_utils/format.ts` — `stageLabel` becomes explicit (avoids `"Inz_submitted"`-style title-casing); `stageStyles` gets a gold tone for `INZ_SUBMITTED`; `CaseStage` union updated.
- `src/app/lia/cases/[id]/inz-data/page.tsx` — banner at the top of the page when the case has been submitted.

No new npm dependencies, no new env vars.

## 3. Schema added

```prisma
enum CaseStage {
  ADMISSION
  VISA
  INZ_SUBMITTED   // new — between VISA and COMPLETED
  COMPLETED
  WITHDRAWN
}

model Case {
  // … existing …
  inzApplicationNumber String?    @db.VarChar(128)
  inzSubmittedAt       DateTime?
  inzSubmissionNotes   String?    @db.Text
  inzReceiptFileUrl    String?
  inzReceiptFileName   String?
  inzReceiptMimeType   String?
  inzReceiptSizeBytes  Int?
  // … existing …
  @@index([inzApplicationNumber])
}
```

Migration `20260526220000_pr_lia_7_inz_submission/migration.sql`:

```sql
ALTER TYPE "CaseStage" ADD VALUE IF NOT EXISTS 'INZ_SUBMITTED' BEFORE 'COMPLETED';
ALTER TABLE "cases" ADD COLUMN "inzApplicationNumber" VARCHAR(128);
ALTER TABLE "cases" ADD COLUMN "inzSubmittedAt"       TIMESTAMP(3);
ALTER TABLE "cases" ADD COLUMN "inzSubmissionNotes"   TEXT;
ALTER TABLE "cases" ADD COLUMN "inzReceiptFileUrl"    TEXT;
ALTER TABLE "cases" ADD COLUMN "inzReceiptFileName"   TEXT;
ALTER TABLE "cases" ADD COLUMN "inzReceiptMimeType"   TEXT;
ALTER TABLE "cases" ADD COLUMN "inzReceiptSizeBytes"  INTEGER;
CREATE INDEX "cases_inzApplicationNumber_idx" ON "cases"("inzApplicationNumber");
```

**`ALTER TYPE … ADD VALUE` in a transaction** — Postgres 12+ permits this as long as the new value isn't *used* in the same transaction. None of our subsequent statements reference `INZ_SUBMITTED`; they only add columns. Single migration is safe.

**Index choice** — non-unique on purpose. Duplicate INZ references are LIA data-entry errors, not data-corrupting; a unique constraint clash would crash an honest submit transaction. The handover's "Known limitations" notes this.

**No backfill** — every existing case has `inzSubmittedAt = NULL` and remains in whatever stage it was already in.

### File-storage decision (the rationale §3 promises)

Three options for the receipt file metadata were considered:

| Option | Pros | Cons |
|---|---|---|
| New `InzSubmissionReceipt` model | Clean separation, multiple-receipts-per-case future | Adds a table for a single 1:1 relationship |
| Reuse `AdmissionDocument` | Existing flow | Semantically wrong (receipts aren't admission docs) |
| **Denormalised columns on `Case` (chosen)** | One row per case, lifecycle bound to submission, no orphan management | Single receipt per case (acceptable for v1 per spec) |

Picked option 3. Forward-compat to multi-receipt is to add the `InzSubmissionReceipt` table later — the existing columns can stay as a "current receipt" pointer, or migrate into rows.

## 4. Endpoint contract

All four routes mounted under `/cases/:id/inz-submission*`. Role-gated to `LIA / ADMIN / SUPER_ADMIN / OWNER`. Actor ID resolved as `req.user?.userId ?? req.user?.id` per the PR-d95640d JWT fix.

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/cases/:id/inz-submission` | multipart: `file` + `inzApplicationNumber` + optional `submittedAt` + optional `notes` | Transition VISA → INZ_SUBMITTED. Validates stage, LIA assigned, no prior submission. |
| PATCH | `/cases/:id/inz-submission` | JSON: any subset of `inzApplicationNumber`, `submittedAt`, `notes` | In-place edit (case must be INZ_SUBMITTED). Receipt cannot be edited here. |
| POST | `/cases/:id/inz-submission/revert` | JSON: `{ reason: string (10–500) }` | Rollback to VISA. Reason encrypted on the audit row. |
| GET | `/cases/:id/inz-submission/receipt-url` | — | Signed download URL valid 5 minutes. |

### Submission preconditions

The service rejects with `400` when any of these is true:

- Case is not in `VISA` stage (e.g. already INZ_SUBMITTED or still in ADMISSION).
- Case has no `liaId` (no LIA can submit a case that hasn't been assigned).
- Case already has `inzApplicationNumber` or `inzSubmittedAt` set (use edit or revert).
- Missing file, wrong mime type, or file > 10 MB.

The rejected upload is unlinked from `./uploads/pending/` to avoid orphan files.

### Edit semantics

- Only `inzApplicationNumber`, `submittedAt`, `notes` are editable.
- The receipt is NOT editable (revert + resubmit to change).
- At least one field must be present in the PATCH body (`400` if none).
- Audit row carries both `oldValue` and `newValue` covering every changed field.

### Revert semantics

- Case must currently be `INZ_SUBMITTED`.
- Required `reason` 10–500 chars, **encrypted** with `CryptoService` and base64-encoded on the audit row's `newValue.reasonEncryptedBase64`.
- All five INZ columns cleared; stage flips back to `VISA`.
- Receipt file **stays on disk** at `./uploads/inz-receipts/<caseId>/`. Recoverable from the audit row's `oldValue.inzReceiptFileName` if anyone needs to forensically retrieve it.
- Forward-compat hook for PR-LIA-8 ("don't allow revert if visa already issued") is commented in the service. No `visaIssued` flag exists yet; gate goes in when it does.

### Sample success response (`POST /cases/:id/inz-submission`)

```json
{
  "id": "cuid",
  "stage": "INZ_SUBMITTED",
  "inzApplicationNumber": "VRC-2026-NZL-12345",
  "inzSubmittedAt": "2026-05-26T00:00:00.000Z",
  "inzSubmissionNotes": "Submitted in person at the Auckland office.",
  "inzReceiptFileName": "inz-receipt-2026-05-26.pdf",
  "inzReceiptMimeType": "application/pdf",
  "inzReceiptSizeBytes": 248320,
  "lead": { /* … */ },
  "lia": { /* … */ }
}
```

## 5. Audit contract

Three new `eventType` values are written by the service:

| Event type | Trigger | `newValue` (selected fields) |
|---|---|---|
| `INZ_SUBMITTED` | Successful submit | `caseId`, `inzApplicationNumber`, `receiptFileName`, `receiptSizeBytes` |
| `INZ_SUBMISSION_EDITED` | Successful edit | Only the changed fields (subset of `inzApplicationNumber`, `inzSubmittedAt`, `inzSubmissionNotes`); `oldValue` carries previous values |
| `INZ_SUBMISSION_REVERTED` | Successful revert | `stage: 'VISA'`, `reasonEncryptedBase64`, `reasonLength`; `oldValue` carries snapshot of cleared fields |

Each event also writes a companion `VisaCaseFileNote` row when the case has reached the visa-side workspace (resolves via `Case → AdmissionApplication → VisaApplication → VisaCase`). Pre-visa cases skip the file-note write; the `AuditLog` row is the canonical record either way.

The `summarizeAuditEntry` helper renders each event as a one-line human string for the activity feed (e.g. `"Submitted to Immigration NZ (VRC-2026-NZL-12345)"`).

## 6. Email contract

`NotificationsService.sendInzSubmittedToClient(email, name, caseId, inzApplicationNumber)` sends a plain HTML email:

- **Subject:** `"Your visa application has been submitted to Immigration NZ"`
- **Body:** confirms the application is with INZ, includes the reference number, notes the platform will update them when there's news, links to `${APP_URL}/student/case` (defaults to `https://app.sorenavisa.com`).

Behaviour:
- Fires after the transaction commits (so the audit + DB write are durable before any email goes out).
- Wrapped in `.catch(err => logger.error(...))` — never throws, never blocks the response.
- Pattern matches `sendNewLiaAssignment` from PR-LIA-2.
- If `SMTP_*` env vars aren't configured, the underlying `sendEmail` logs `"Email not sent to … : SMTP configuration missing"` and returns — same behaviour as every other email in the project.

If the case's `lead.contact.email` is `null`, the email is skipped and the service logs a warning (`"INZ submission recorded for case X but no client email on file"`). The submission still succeeds.

## 7. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **Migration applied:** `npx prisma migrate status` shows `20260526220000_pr_lia_7_inz_submission` applied. `\d cases` shows the seven new columns + the `inzApplicationNumber` index. `SELECT enum_range(NULL::"CaseStage");` lists `INZ_SUBMITTED` between `VISA` and `COMPLETED`.
3. **Backend boots:** PM2 shows `sorena-backend` online; `curl http://localhost:3001/cases` returns `401` (auth gate alive). The new four routes (`POST/PATCH/POST/GET .../inz-submission*`) all return `401` unauthenticated — confirms they're mounted.
4. **Case detail page (VISA stage):** open `/lia/cases/<id>` for a case currently in VISA with an LIA assigned. Above the legal-flags banner you see the gold CTA card "Ready to submit to Immigration NZ?" with the Submit button.
5. **Submit flow.** Click Submit. Overlay opens. Enter `VRC-2026-NZL-12345`, today's date, attach a PDF, optional notes. Click Submit. Modal closes; page refreshes.
6. **INZ_SUBMITTED panel renders.** The gold CTA is gone; in its place is the full INZ Submission panel — reference (with Copy button), submission date + relative time, days-at-INZ counter, notes if any, then the action row (Download receipt, Edit, Revert).
7. **Client email.** In dev with SMTP configured, check the client's inbox. With no SMTP, look at the backend log for `"Email not sent to <addr>: SMTP configuration missing"`.
8. **Header stage badge.** The case header now shows the `INZ_SUBMITTED` badge in gold (rather than VISA's purple).
9. **Edit.** Click Edit. Change the reference; Save. Page refreshes with the new value. Audit log shows an `INZ_SUBMISSION_EDITED` row with `oldValue` + `newValue`.
10. **Download.** Click "Download receipt". A new tab opens with the file (served via `/files/signed/:token`, 5-minute TTL).
11. **Revert.** Click Revert. Confirmation overlay appears. Reason ≥ 10 chars + typing the case ID into the confirmation field both required. Click Revert. Page refreshes; case is back in VISA stage; INZ submission panel reverts to the gold CTA again.
12. **Audit log:**
    ```sql
    SELECT id, "eventType", "newValue", "createdAt"
      FROM audit_logs
     WHERE "entityType" = 'CASE'
       AND "eventType" IN ('INZ_SUBMITTED','INZ_SUBMISSION_EDITED','INZ_SUBMISSION_REVERTED')
     ORDER BY "createdAt" DESC LIMIT 5;
    ```
    Should show all three event types in order.
13. **Stage filter chip.** On `/lia/cases`, click the new "INZ Submitted" chip — the queue filters to only cases in that stage.
14. **INZ data viewer banner.** Open `/lia/cases/<id>/inz-data` for a submitted case. The green-tick banner appears above the section list: "This case was submitted to INZ on … with reference …".
15. **Validation.** Try to POST `/cases/<id>/inz-submission` against a case still in ADMISSION → `400` "Case must be in VISA stage". Try with no `liaId` → `400` "Case must have an assigned LIA before submitting to INZ". Upload a `.docx` → `400` "Unsupported receipt type". Upload an 11 MB PDF → `400` size error.

## 8. Known limitations

- **Receipt cannot be edited in place.** The LIA must revert + resubmit to swap the receipt. PR-LIA-7.1 candidate.
- **One receipt per case.** A future "INZ asked for additional payment" scenario would need either revert-resubmit or a proper `InzSubmissionReceipt[]` model.
- **No INZ status polling.** Once submitted, there's no automatic "INZ has asked for more info" / "INZ has decided" workflow. PR-LIA-8 territory.
- **No format validation on the INZ reference.** Any 1–128 char string is accepted. Common formats are `VRC-YYYY-NZL-NNNNN` but we don't enforce because INZ's portal reference shape changes over time and a strict regex would block valid references.
- **Revert is allowed at any time** while in `INZ_SUBMITTED`. The forward-compat comment in the service shows where to add a "don't revert if visa already issued" gate once PR-LIA-8 introduces a `visaIssued` flag.
- **Email is plain HTML + best-effort.** No retry, no resend, no template management. Matches the PR-LIA-2 pattern. If the client misses the email, the LIA can mention it in the case-thread (PR-LIA-4).
- **No bulk submission.** One case at a time.
- **The receipt file stays on disk after revert.** Recoverable via the audit log (the `oldValue.inzReceiptFileName` snapshot tells you which file to find under `./uploads/inz-receipts/<caseId>/`). No automatic cleanup job; disk grows linearly with revert volume.
- **The `inzApplicationNumber` index is non-unique.** Two cases with the same reference is an LIA data-entry error, not data-corrupting — we don't want a unique constraint clash to crash a submit transaction.
- **No client-facing surface for the submission.** The student dashboard sees the new stage via existing `case.stage` rendering (the `INZ_SUBMITTED` i18n key was already present in `en.json` + `fa.json`), but there's no dedicated "your case at INZ" section. The email is the primary client notification.
- **Days-at-INZ is computed client-side from `inzSubmittedAt`.** No server-side derived field. Recomputed on every render, which is fine at small scale.
- **The pending-uploads sweep in `main.ts`** runs every 60 minutes and deletes files in `./uploads/pending/` older than an hour. If a multipart upload lands but the service throws before moving the file, the orphan is cleaned within an hour.
- **Revert reason is encrypted-base64 on the audit `newValue` JSON.** That works for forensic reading but isn't decryptable from the audit-feed UI (the helper doesn't load `CryptoService`). The summarizer just notes the revert happened; the full reason requires a backend script to decrypt.

## 9. How to extend

- **PR-LIA-7.1 — receipt re-upload during edit.** Replace the text-only PATCH with a multipart variant; service deletes the old file (or moves it to an `./uploads/inz-receipts/<caseId>/archive/` folder) and writes the new one. Audit row distinguishes "metadata edit" from "receipt swap".
- **Multiple receipts per case.** New `InzSubmissionReceipt` table keyed on `(caseId, uploadedAt)`. Migrate the four `inzReceipt*` columns to a `latestReceiptId` FK; or keep them as a denormalised "current" pointer for fast reads.
- **INZ status polling (PR-LIA-8).** New `inzStatus` enum on `Case` (`WAITING_FOR_DECISION`, `ADDITIONAL_INFO_REQUESTED`, `APPROVED`, `DECLINED`, etc.) + status-update endpoint. Per-status frontend panels. Tie into `revertInzSubmission`'s forward-compat gate (don't allow revert after `APPROVED`).
- **Auto-detect INZ reference format.** Add a soft regex hint in the SubmitToInzButton overlay ("Tip: looks like the standard format is VRC-YYYY-NZL-NNNNN") without enforcing it.
- **HTML email templates.** Extract the inline HTML into separate template files under `src/notifications/templates/`. Add a templating engine (Handlebars / EJS) — that's a new npm dep though, so judge case-by-case.
- **Resend email.** Add `POST /cases/:id/inz-submission/resend-email`. Same role gate; writes an audit row; doesn't change the case.
- **Visa expiry / decision reminders (PR-LIA-9).** Cron job scanning `inzSubmittedAt + N days`; LIA gets a Slack/email nudge if no status update.
- **Bulk submission.** Multi-select on `/lia/cases`; new endpoint `POST /cases/bulk-submit-inz` accepting an array of `{caseId, …}`. Service runs the existing per-case logic inside one `$transaction`. Likely only valuable for OWNER batch operations.
- **Server-side derived `daysAtInz` column** — generated column or trigger. Not worth it at current scale; the client-side compute is fine.

## 10. Security layers applied

- **Layer 1 — Auth.** `JwtAuthGuard` at the class level. Frontend `/lia/*` portal layout pre-gates.
- **Layer 2 — Role gate.** `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')` on the class. Backend authoritative.
- **Layer 3 — Env vars.** No new vars. SMTP setup is shared with the rest of `NotificationsService`. Encryption uses the existing `ENCRYPTION_KEY` / `ENCRYPTION_KEY_VERSION`.
- **Layer 4 — HTTPS.** Production enforced by Vercel + Railway.
- **Layer 5 — Rate limiting.** Inherits the global 60/min throttler. No per-endpoint cap; these are low-frequency staff actions.
- **Layer 6 — Audit log.** Every mutation writes an `AuditLog` row inside the same `$transaction` as the data change. Three new event types added to the helper. Snapshot columns populated at write time per PR-CONSULT-4.
- **Layer 7 — File uploads.** Multer config matches the admission pattern: disk storage in `./uploads/pending/`, 10 MB max, mime-type whitelist (PDF / JPEG / PNG / HEIC). Rejected uploads are silently filtered and unlinked. The service re-validates and throws a clean 400 if anything slips through. After validation the file moves to `./uploads/inz-receipts/<caseId>/`. Downloads use the existing PR-SEC3 signed-URL pattern — 5-minute TTL JWT-signed payloads.
- **Layer 8 — Auto-logout.** Handled by existing session-expiry middleware.
- **Layer 9 — npm audit.** No new dependencies.
- **Layer 10 — DB backups.** Seven new columns on `cases`; existing nightly Postgres backup picks them up. The receipt files on disk are NOT in the DB backup — that's a known gap for the project as a whole (file backup is out of scope for this PR).

**Encryption of the revert reason.** The reason field on `POST /cases/:id/inz-submission/revert` is encrypted via `CryptoService.encrypt` and stored as base64 inside the audit log's `newValue.reasonEncryptedBase64`. The summarizer doesn't decrypt; a forensic check via the backend can.

**Cross-case attack defence.** Every endpoint passes the `:id` path parameter into `prisma.case.findUnique` and confirms the row exists. The file storage path `./uploads/inz-receipts/<caseId>/` is parameterised by the case ID, so a malicious LIA can't read another case's receipt without going through `getReceiptInfo` (which is role-gated and reads from the requested case's row).

## 11. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git log --oneline -5            # confirm the top two are the PR-LIA-7 commits
git revert HEAD~1..HEAD

# 2. drop the new columns + index. The enum value is left in place —
#    Postgres does not support DROPPING an enum value, and leaving
#    INZ_SUBMITTED as an unused enum literal is harmless.
psql -d sorenavisaplatform <<SQL
DROP INDEX IF EXISTS "cases_inzApplicationNumber_idx";
ALTER TABLE "cases"
  DROP COLUMN IF EXISTS "inzApplicationNumber",
  DROP COLUMN IF EXISTS "inzSubmittedAt",
  DROP COLUMN IF EXISTS "inzSubmissionNotes",
  DROP COLUMN IF EXISTS "inzReceiptFileUrl",
  DROP COLUMN IF EXISTS "inzReceiptFileName",
  DROP COLUMN IF EXISTS "inzReceiptMimeType",
  DROP COLUMN IF EXISTS "inzReceiptSizeBytes";

-- Cases currently in INZ_SUBMITTED stage need to be moved back to
-- VISA before the rollback completes (or the next Prisma generate
-- against the reverted schema will choke on unknown enum values).
UPDATE "cases" SET "stage" = 'VISA' WHERE "stage" = 'INZ_SUBMITTED';

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260526220000_pr_lia_7_inz_submission';
SQL

# 3. push the revert
git push origin main

# 4. (optional) clean up the on-disk receipts
#    rm -rf ./uploads/inz-receipts
```

**Verification after rollback:**

```bash
cd backend && npx tsc --noEmit          # clean
cd frontend && npx tsc --noEmit         # clean
curl -i http://localhost:3001/cases/<id>/inz-submission -H "Authorization: Bearer <jwt>"
#   → 404 (route gone)
```

The enum value `INZ_SUBMITTED` stays in the DB forever (Postgres limitation — `ALTER TYPE … DROP VALUE` doesn't exist). It's harmless dead code; a future PR can ignore it. Receipt files on disk are unaffected by the SQL rollback; delete the directory manually if disk space matters.
