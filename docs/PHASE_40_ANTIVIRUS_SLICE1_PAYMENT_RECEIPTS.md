# Phase 40 — Antivirus, slice 1: payment receipts

**Status:** DONE — 18 August 2026
**Commits:** `9c16d1d` (the slice), `c220a43` (a test that was matching its own source)
**Slice 1 of 6** in the plan recorded in the virus-scanning state-check. Slices 2–6 are not built.

---

## 1. What this phase does

Every payment receipt a client uploads is now scanned for malware before it is stored. A ClamAV
container runs alongside the backend on Railway; the receipt endpoint streams the file to it and
only writes the invoice row if the answer is clean. An infected file is refused, never saved, and
recorded in the audit log with who uploaded it and what was detected — while the person uploading
is told only that the file could not be accepted.

This is deliberately the **narrowest possible first slice**: the manual bank-transfer receipt, and
nothing else. It was chosen because a Finance Admin opens these files by hand, which makes it the
highest-consequence upload on the platform. Every other upload surface is untouched and unscanned.

## 2. Files created or changed

**Created**
| File | Purpose |
|---|---|
| `backend/src/common/antivirus/antivirus.service.ts` | The scanner client. Speaks clamd's INSTREAM protocol over TCP directly; exposes `scanFile()`, `scanBuffer()`, `ping()` and `configured`. |
| `backend/src/common/antivirus/antivirus.module.ts` | `@Global()` module providing the service, so slices 2–6 need no per-module wiring. |
| `backend/src/common/antivirus/antivirus.service.spec.ts` | 15 tests against a fake clamd — framing, multi-chunk bodies, and every way a non-clean answer must not become clean. Also asserts the single-caller boundary. |

**Changed**
| File | Change |
|---|---|
| `backend/src/portal/portal.service.ts` | The scan itself: injected `AntivirusService`, added the scan between the last validation and the only write, plus the two rejection branches and their audit rows. **The only product caller.** |
| `backend/src/app.module.ts` | Registers `AntivirusModule`. |
| `backend/src/portal/portal.service.spec.ts` | Constructor gained a 5th argument — clean-by-default stub. |
| `backend/src/portal/portal-contract-request.spec.ts` | Same. |
| `backend/src/portal/portal-invoices.spec.ts` | Same. |
| `backend/src/portal/portal.lia-notice.spec.ts` | Same. |
| `backend/src/portal/portal.phase-b-notice.spec.ts` | Same. |

`backend/scripts/test-client-contract-onramp.ts` also needed the new constructor argument, but it
is gitignored (`backend/.gitignore:30`) so it is not in the commit. A fresh clone that restores
that script will need the same one-line change.

**No frontend change.** The client already surfaces the endpoint's error message; a 422 renders
the same way any other refusal does.

## 3. Database / config changes

**No migration. No schema change.** Nothing was added to `schema.prisma`.

**Two new audit event types**, written to the existing `AuditLog` table:

| `eventType` | When | Payload |
|---|---|---|
| `RECEIPT_UPLOAD_REJECTED_MALWARE` | clamd returned FOUND | `fileName`, `mimeType`, `sizeBytes`, `signature`, `outcome: "rejected — not stored"`; `userId` = the uploader, `entityId` = the invoice |
| `RECEIPT_UPLOAD_REJECTED_SCANNER_UNAVAILABLE` | clamd unreachable, timed out, or unintelligible | `fileName`, `reason`, `outcome: "rejected — not stored"` |

The existing `RECEIPT_UPLOADED` event is unchanged and still written on the clean path.

## 4. Environment variables added

On the **backend** service (`SorenaVisaPlatform`):

- `CLAMAV_HOST`
- `CLAMAV_PORT`

`CLAMAV_TIMEOUT_MS` is read by the code and defaults to 20000; it is not set in production and
does not need to be.

⚠️ **`CLAMAV_HOST` is not an on/off switch.** Unsetting it does not disable scanning — it makes
every scan return UNAVAILABLE, and because the design fails closed, **all receipt uploads would be
refused**. See §10.

## 5. Third-party services connected

**`clamav`** — a new Railway service in the `peaceful-imagination` project, production environment.

- Image: `clamav/clamav:stable`
- Reachable only on Railway's private network at `clamav.railway.internal:3310` — no public domain,
  no ingress
- Its own tile and container, no shared state with the backend, same pattern as the existing
  `docuseal` service
- Signature updates are handled inside the image by `freshclam` on its own schedule

Manage it at: Railway → `peaceful-imagination` → production → **clamav**. Logs there show
signature loading and `socket found, clamd started`.

## 6. How to test it works

**The infected case.** EICAR is the industry-standard antivirus test file — a harmless 68-byte
ASCII string that every scanner is required to detect. It is not malware.

1. Sign in to the client portal as a client with an invoice in `SENT` or `OVERDUE` status.
2. Create a file containing exactly:
   `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`
   Save it as `receipt.pdf` (the extension does not matter to the scanner; the endpoint's mime
   whitelist means it must be sent as a PDF or image).
3. Upload it as the bank-transfer receipt for that invoice.
4. **Expect HTTP 422** and the message *"This file could not be uploaded. Please try a different
   file."* — no mention of a virus, a signature, or a scanner.
5. Confirm the invoice still has **no** receipt (`receiptUploadedAt` is null) and nothing was
   written to `/data/uploads/receipts/`.
6. Confirm an `AuditLog` row exists with `eventType = 'RECEIPT_UPLOAD_REJECTED_MALWARE'` naming the
   uploader and the signature.

**The clean case.**

7. Upload an ordinary PDF or JPG receipt to the same invoice.
8. **Expect HTTP 201** and `{"ok": true, "status": "processing"}`.
9. Confirm the file is on the volume — `Invoice.receiptFileUrl` starts with `/data/uploads/` — and
   `receiptUploadedAt` is set, so Finance Admin sees it awaiting verification.

**What was actually run, 18 Aug 2026** — against production, through the real endpoint, with a
throwaway client and invoices that were deleted afterwards:

```
EICAR    → HTTP 422, message exactly as above, nothing technical leaked
PDF      → HTTP 201, {"ok":true,"status":"processing"}
JPG      → HTTP 201, uploaded to the SAME invoice EICAR had targeted — which
           only succeeds if the infected attempt left no receipt behind
audit    → RECEIPT_UPLOAD_REJECTED_MALWARE, signature "Eicar-Test-Signature",
           filename receipt.pdf, uploader recorded, outcome "rejected — not stored"
stored   → /data/uploads/receipts/1787005400064-…pdf, receiptUploadedAt set
7/7 endpoint checks, 11/11 database checks
```

Backend suite: **1470 passing**.

## 7. Known limitations

- **Only payment receipts are scanned.** Everything else still accepts files unscanned: case visa
  documents, student visa documents, admission documents, INZ submission receipts, LIA licence
  files, HR documents, provider marketing materials, programme cover images, staff photos, ticket
  attachments, and the Excel importers (tuition / scholarship / programme). A test asserts the
  scanner has exactly one caller, so extending it has to be deliberate.
- **Client case documents cannot be scanned this way at all.** They upload directly to R2 via a
  presigned PUT, so the backend never holds the bytes. That is slice 3, and it needs the upload
  flow changed before scanning is even possible.
- **No cleanup job for orphaned stored files.** Accepted receipts stay on the volume even if their
  invoice row is later deleted; there is no endpoint or sweeper that removes a stored file. Three
  such orphans exist today (one probe PDF from the volume verification, two receipts from this
  phase's testing).
- **Scanning is synchronous and adds latency** to the upload response — a few hundred milliseconds
  for a typical receipt. Acceptable here; worth re-measuring before applying it to a bulk path.
- **No quarantine.** An infected file is deleted, not preserved for inspection. Quarantining is
  slice 4.
- **No staff visibility.** The rejections are in the audit log; nothing surfaces them on a screen.

## 8. How a future developer would extend this

`AntivirusService` is `@Global()`, so any service can inject it without a module import:

```ts
constructor(private readonly antivirus: AntivirusService) {}
```

Then, for a multipart endpoint that already has the bytes:

```ts
const verdict = await this.antivirus.scanFile(file.path);   // diskStorage
const verdict = await this.antivirus.scanBuffer(file.buffer); // memoryStorage
```

**Copy the shape from `portal.service.ts` — it is the only current caller and the reference
implementation.** Three things matter and are easy to get wrong:

1. **Scan after the cheap checks, before the only write.** A file that was never going to be
   accepted does not need scanning; a file that is about to be accepted must not be stored
   unscanned.
2. **Handle three verdicts, not two.** `CLEAN`, `INFECTED`, and `UNAVAILABLE`. Treating UNAVAILABLE
   as clean silently removes the control while leaving it visible in the code.
3. **Clean up the temp file on every rejection path.** On `diskStorage` endpoints multer has
   already written the file before the handler runs.

The single-caller test in `antivirus.service.spec.ts` will fail when a second caller appears —
update its expected list in the same commit that adds the caller, so the change is on the record.

## 9. Security layers applied

**File type whitelist (pre-existing).** `RECEIPT_ALLOWED_MIMES` in `portal.controller.ts` —
`application/pdf`, `image/jpeg`, `image/png`. Enforced by multer's `fileFilter` before the handler
runs; a rejected type returns 415.

**File size limit (pre-existing).** 10 MB, `limits.fileSize` in the same multer config.

**Malware scanning (new).** `portal.service.ts` → `antivirus.scanFile()`, positioned between the
last validation and the only database write.

**Fail-closed.** `antivirus.service.ts` returns `UNAVAILABLE` — never `CLEAN` — when clamd is
unreachable, times out, replies with `ERROR`, replies with something unparseable, replies with
nothing, or is unconfigured. The handler refuses the upload on that verdict. A scanner that
silently stops scanning is worse than no scanner, because the control still appears to be there.

**Error messages carry no detail.** The infected response says only *"This file could not be
uploaded. Please try a different file."* The signature, the scanner's existence and the reason all
go to the audit log instead. UNAVAILABLE returns a deliberately different message — that outage is
ours, not the uploader's file's fault — so the two cases are never conflated.

**Ownership (pre-existing).** The endpoint already verified the invoice belongs to a case owned by
the calling user before any of this; the scan sits after that check.

**Audit trail.** Both rejection paths write an `AuditLog` row before the exception is thrown, so a
refusal is recorded even though nothing was stored.

**Network isolation.** clamd has no public domain. It is reachable only at
`clamav.railway.internal:3310` on Railway's private network.

## 10. Rollback instructions

**Do not unset `CLAMAV_HOST` to turn scanning off.** Because the design fails closed, an unset host
makes every scan return UNAVAILABLE and **blocks all receipt uploads**. It is the opposite of a
bypass.

**There is deliberately no bypass flag.** A "skip scanning" environment variable is a switch
someone flips during an incident and forgets, leaving the control silently off. If you want one,
it should be added consciously with an alert attached.

To disable scanning, revert the code. The minimal change, leaving the ClamAV service running and
every other file untouched:

1. In `backend/src/portal/portal.service.ts`, delete the block between the comment
   `── PR-AV slice 1 — scan before this file becomes a stored receipt ──` and the
   `await this.prisma.invoice.update({` that follows it — the `scanFile` call and the two `if
   (verdict.status === …)` branches.
2. Deploy. Receipts then behave exactly as they did before this phase.

Or revert the whole slice:

```bash
git revert c220a43 9c16d1d
```

That also removes `AntivirusService`, so update the five spec files' constructor arguments back to
four in the same commit.

**The `clamav` Railway service can stay running either way.** It costs a container and holds no
state the platform depends on; nothing else talks to it. Delete it from the Railway dashboard only
if you are abandoning the remaining slices — slices 2–6 all need it.

The environment variables can also stay: with the code reverted, nothing reads them.
