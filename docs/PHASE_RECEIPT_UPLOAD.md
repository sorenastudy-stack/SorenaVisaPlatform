# Phase: Client Payment-Receipt Upload + "Processing" State (Piece #2)

## 1. What it does

After a client pays their engagement invoice by **bank transfer** or **partner exchange (Rebit)**, they upload a payment receipt directly in the portal (`/portal/case/pay`). Uploading the receipt moves the invoice into a **"processing / awaiting confirmation"** state:

- The receipt file is stored and `Invoice.receiptUploadedAt` is set.
- **The invoice status STAYS `SENT`** — it is *not* marked paid. An accountant confirms the funds landed in a later piece.
- The Pay-now options are replaced by a calm **"Payment received — we're confirming it"** status card.
- `buildNextSteps` emits an `INVOICE_PROCESSING` step instead of the `INVOICE` (pay-now) step.

**Stripe card payments are unaffected** — they still auto-reconcile `SENT`/`OVERDUE` → `PAID` via the existing webhook. This feature only adds an out-of-band evidence path for the two manual payment methods.

## 2. Files changed

- `backend/prisma/schema.prisma` — 6 nullable `receipt*` columns added to the `Invoice` model.
- `backend/src/portal/portal.controller.ts` — multer receipts config (disk storage, type allowlist, 10 MB cap) + `POST me/invoices/:invoiceId/receipt` + `GET me/invoices/:invoiceId/receipt/download`.
- `backend/src/portal/portal.service.ts` — `uploadInvoiceReceipt()`, `getInvoiceReceiptDownloadUrl()`, `processing` flag in `getInvoicePayOptions()`, and the `INVOICE_PROCESSING` branch in `buildNextSteps()`.
- `frontend/src/app/portal/case/pay/page.tsx` — processing-state early return + receipt upload pickers under the bank and partner-exchange sections.
- `frontend/src/components/portal/ReceiptUpload.tsx` — new client component: multipart upload with client-side type/size checks, then `router.refresh()` into the processing state.

## 3. Database changes

Six **nullable** columns added to `Invoice`, denormalized onto the row (same pattern as `Case.inzReceipt*`):

| Column | Type | Purpose |
|--------|------|---------|
| `receiptFileUrl` | `String?` | Local path (later R2 key) of the stored receipt |
| `receiptOriginalName` | `String?` | Original upload filename (for download) |
| `receiptMimeType` | `String?` | Stored MIME (pdf/jpeg/png) |
| `receiptSizeBytes` | `Int?` | File size in bytes |
| `receiptMethod` | `String?` | `'bank'` or `'exchange'` |
| `receiptUploadedAt` | `DateTime?` | Timestamp of upload — **the "processing" flag** |

- **"Processing" = `receiptUploadedAt IS NOT NULL`.** No new `InvoiceStatus` enum value and no new `invoice_receipts` table — this keeps the Stripe reconciliation path (`SENT`/`OVERDUE` → `PAID`) completely untouched.
- Applied via `npx prisma db execute --file alter.sql` (raw additive `ALTER TABLE ... ADD COLUMN`), then `npx prisma generate`. **Not** `prisma migrate dev`.
- **Additive and non-destructive** — no existing column, index, or row was modified.

> **Known drift (post-launch cleanup item):** This database's `_prisma_migrations` history is drifted (15 recorded rows vs 76 migration files; tables already exist), so `migrate dev`/`migrate deploy` fail on shadow-DB replay of an old migration. Schema changes are currently applied surgically via `db execute`. Reconciling the migration history (baseline/resolve) is a tracked cleanup task to do before relying on `migrate` again.

## 4. Environment variables

**None new.** Uses existing config by name only:
- `UPLOAD_DIR` (defaults to `./uploads`) — receipts are stored under `${UPLOAD_DIR}/receipts`.
- The existing signed-URL secret used by `createSignedDownloadToken` / the `/files/signed/:token` route (unchanged).

## 5. Third-party services

**None new.** Files are stored on **local disk** in this phase. Production will point `UPLOAD_DIR`-equivalent storage at **Cloudflare R2** at deploy time (see §8) — the download already goes through a signed-token indirection, so the swap is storage-layer only.

## 6. How to test

All nine checks below passed against the running backend as `lead2@booking.test` (STUDENT role) on the ENG engagement invoice:

1. **Upload JPEG (bank)** → `201 {ok, status:'processing'}`; all 6 fields written; file on disk under `uploads/receipts/`; invoice status **stays `SENT`**; `receiptUploadedAt` set.
2. **`buildNextSteps`** now emits `INVOICE_PROCESSING` and the `INVOICE` (Pay-now) step is **suppressed**.
3. **Signed download (owner)** mints `/files/signed/:token`; fetching it returns `200` with the correct content-type.
4. **Second upload** on the same invoice → `409` ("A receipt is already under review for this invoice.").
5. **Reset + upload PDF (exchange)** → `201`; mime/method stored correctly; file on disk.
6. **Type reject** — `.txt` and `.exe` → `415` ("Only PDF, JPEG, and PNG files are accepted.").
7. **Oversized** — 11 MB file → `413` ("File too large").
8. **Invalid method** — `method=card` → `400` ("method must be 'bank' or 'exchange'").
9. **Ownership** — a foreign invoice returns `404` on **both** upload and download (no existence leak).

Browser: log in as `lead2@booking.test`, go to `/portal/case/pay`, expand "Already paid by bank transfer?", upload a receipt → the page refreshes into the "Payment received — we're confirming it" card and the pay options disappear.

## 7. Known limitations

- **Local-disk storage** until R2 is configured (deploy-day swap).
- **No accountant confirmation yet** — the invoice sits in "processing" indefinitely; flipping it to `PAID` is the next piece.
- **One receipt per invoice** — a second upload is blocked (`409`); there is no re-upload / replace UI for the client.
- **Status stays `SENT`**, so the processing state is driven by `buildNextSteps` (via `receiptUploadedAt`), not by an enum value. Any consumer reasoning purely off `InvoiceStatus` will still see `SENT`.

## 8. How to extend

- **Accountant confirm flow (next piece):** a staff-gated endpoint to review the uploaded receipt, then flip the invoice `SENT` → `PAID` (and unlock Stage-2 access), with its own audit event. This is the intended completion of the manual-payment loop.
- **Re-upload / replace:** allow the client to replace a receipt while still in processing (clear the old file, write the new one, keep the audit trail).
- **R2 swap:** change the storage destination from `diskStorage` to an R2 put and store the R2 key in `receiptFileUrl`; the signed-download indirection stays the same.

## 9. Security layers

- **#7 File upload:** MIME allowlist (`application/pdf`, `image/jpeg`, `image/png`) at the multer `fileFilter`; 10 MB `limits.fileSize` cap (`MulterExceptionFilter` maps `LIMIT_FILE_SIZE` → `413`); random server-generated filename (no client-controlled path); download only via a short-lived signed token — **no public URL**.
- **#2 Access control:** routes are class-gated `@Roles('LEAD','STUDENT')`; the invoice is resolved through the ownership chain `JWT userId → lead.contact.userId → case → invoice`; a foreign or unknown invoice returns the **same `404`** on both upload and download (no existence leak).
- **#1 Authentication:** `JwtAuthGuard` on every route; actor id taken from the verified JWT, never from the request body.
- **#6 Audit:** each successful upload writes an `AuditLog` `RECEIPT_UPLOADED` event (method, mimeType, sizeBytes).
- **#10 Data protection:** a database backup was taken before the additive column change; the change is non-destructive and reversible.

## 10. Rollback

1. **Revert the commit** — removes the endpoints, the upload UI, and the `INVOICE_PROCESSING` branch, restoring the original pay screen and next-steps behaviour.
2. **The 6 columns are harmless if left** — they are nullable and unread once the code is reverted. To drop them fully:
   ```sql
   ALTER TABLE "Invoice"
     DROP COLUMN "receiptFileUrl",
     DROP COLUMN "receiptOriginalName",
     DROP COLUMN "receiptMimeType",
     DROP COLUMN "receiptSizeBytes",
     DROP COLUMN "receiptMethod",
     DROP COLUMN "receiptUploadedAt";
   ```
   (Run via `prisma db execute`, matching how they were added, then `prisma generate`.)
3. Any receipt files already written under `uploads/receipts/` can be deleted from disk; no other table references them.
