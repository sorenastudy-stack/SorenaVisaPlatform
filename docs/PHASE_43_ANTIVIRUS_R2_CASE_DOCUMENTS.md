# Phase 43 — Antivirus: R2 case documents

**Status:** DONE — 18 August 2026
**Commit:** `139152b`
**Closes** the last unscanned upload path on the platform. Follows
[PHASE_40](PHASE_40_ANTIVIRUS_SLICE1_PAYMENT_RECEIPTS.md) (payment receipts),
[PHASE_41](PHASE_41_ANTIVIRUS_SLICE2_ALL_UPLOAD_POINTS.md) (21 in-handler routes) and
[PHASE_42](PHASE_42_ANTIVIRUS_CLAMD_HARDENING.md) (clamd hardening).

---

## 1. What this phase does

Case documents were the one upload path the previous three slices could not reach. The browser
PUTs them straight to Cloudflare R2 with a presigned URL, so the backend never holds the bytes and
there is no handler in which to refuse them — bolting a scan onto the endpoint that *issues* the
presigned URL cannot work, because at that moment there is no file yet.

Scanning therefore happens after the fact. A 15-second poll picks up documents awaiting a verdict,
fetches the object from R2, and scans it through the **same** `AntivirusService` every other upload
point uses. Clean documents are left where they are; infected ones are deleted from the bucket and
audited. What makes the delay safe is the download gate: the signed-URL endpoint now refuses any
document that is not `CLEAN`, and Phase 0 confirmed that endpoint is the only way to reach an
object at all.

**This route's guarantee is weaker than every other route's, and deliberately described as such
throughout** — see §7. An infected case document *does* briefly exist in storage before it is
deleted. That is a structural consequence of presigned-direct upload, not a defect, and it is
recorded as an accepted exception rather than quietly presented as equivalent.

## 2. Files created or changed

9 files, +666 / −64.

**Created**
| File | Purpose |
|---|---|
| `backend/prisma/migrations/20260818030000_document_scan_status/migration.sql` | The additive migration — new enum, four columns, one index. |
| `backend/src/documents/document-scan.service.ts` | **The poll job.** `@Cron('*/15 * * * * *')`, batch fetch → scan → verdict → delete-if-infected → audit. |
| `backend/src/documents/document-scan.service.spec.ts` | 13 tests: delete-on-infected, fail-closed on outage, the retry query, the stuck-row alarm firing exactly once, and that it declares no scanning logic of its own. |
| `backend/src/documents/documents-scan-gate.spec.ts` | 5 tests pinning the download gate — one per state, plus that the three refusals are distinct and none mentions a scanner. |

**Changed**
| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | `DocumentScanStatus` enum + four fields + index on `Document`. |
| `backend/src/documents/documents.service.ts` | **The download gate** in `getDownloadUrl` — refuses anything not `CLEAN`, three distinct messages. |
| `backend/src/documents/documents.module.ts` | Registers `DocumentScanService`. `AntivirusModule` is `@Global`, so no import needed. |
| `backend/src/common/r2/r2.service.ts` | New `getObjectBytes(key)` — the only path that pulls bytes back out of R2. Returns `null` for a missing object rather than throwing. |
| `backend/src/documents/documents.service.spec.ts` | Existing download fixture predated `scanStatus`, so the new gate (correctly) refused it; fixture now sets `CLEAN`, and `DocumentShape` gained the optional field. |

**Where the scan sits in the flow.** `requestUpload` → *(browser PUTs to R2)* → `confirmUpload`
flips `PENDING`→`UPLOADED` and the row is already `PENDING_SCAN` by default → the poll job resolves
it → `getDownloadUrl` will only issue a URL once it is `CLEAN`. Nothing in `confirmUpload` changed;
the default on the column does the work.

## 3. Database changes

**Migration `20260818030000_document_scan_status`** — purely additive, no backfill script, no data
rewrite:

```sql
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING_SCAN', 'CLEAN', 'INFECTED', 'SCAN_ERROR');

ALTER TABLE "documents"
  ADD COLUMN "scanAttempts"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scanCheckedAt" TIMESTAMP(3),
  ADD COLUMN "scanSignature" TEXT,
  ADD COLUMN "scanStatus"    "DocumentScanStatus" NOT NULL DEFAULT 'PENDING_SCAN';

CREATE INDEX "documents_scanStatus_idx" ON "documents"("scanStatus");
```

| Field | Meaning |
|---|---|
| `scanStatus` | `PENDING_SCAN` \| `CLEAN` \| `INFECTED` \| `SCAN_ERROR`. The only thing the download gate reads. |
| `scanSignature` | The detection name when `INFECTED` (e.g. `Eicar-Test-Signature`). Null otherwise. |
| `scanCheckedAt` | When the job last looked at this row — makes a stalled sweep visible in a query. |
| `scanAttempts` | Consecutive attempts. Drives the loud-once alarm at 10, and parks unresolvable rows. |
| index on `scanStatus` | The job's only query is "rows awaiting a verdict, oldest first". |

**The default IS the backfill.** Every pre-existing row became `PENDING_SCAN` the moment the
column was added, so the poll job picked them up like any new upload — no separate script, nothing
to run by hand, and no window where an old row was assumed clean. All **7 production rows
transitioned `PENDING_SCAN` → `CLEAN`** within a few cycles of deploy.

Applied with the repo's isolated additive pattern (`migrate diff` against `HEAD`'s schema, then
`db execute`, then `migrate resolve --applied`), because `prisma migrate dev` remains unusable here
against the pre-existing drift.

## 4. Environment variables added

**None.** The job reuses `CLAMAV_HOST` / `CLAMAV_PORT` (via the shared `AntivirusService`) and the
existing `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` / `R2_BUCKET_NAME`. No new
configuration of any kind — the poll interval and batch size are constants in the source (§8).

The standing warning still applies: unsetting `CLAMAV_HOST` does not disable scanning. On this
path it means every document stays `SCAN_ERROR` and therefore undownloadable, rather than being
accepted unscanned.

## 5. Third-party services connected

**None new.** The same `clamav` service from Phase 42 and the same Cloudflare R2 bucket. What
changed is that the backend now *reads* objects back out of R2 (`getObjectBytes`), where before it
only ever wrote them or signed URLs for them.

## 6. How to test it works

**The whole point is to use the real client flow.** A shortcut that writes the object server-side
does not exercise the thing under test — bytes reaching R2 before any scan is possible.

1. `POST /cases/:caseId/documents/request-upload` with `{ originalName, mimeType, sizeBytes }` →
   returns `documentId` and `uploadUrl`.
2. `PUT` the bytes to `uploadUrl` directly, exactly as the browser does.
3. `POST /cases/:caseId/documents/:documentId/confirm`.
4. `GET /cases/:caseId/documents/:documentId/download-url` **immediately** — expect **422
   "This document is still being processed. Please try again in a moment."**
5. Wait up to ~30s, then poll the same endpoint.

For an EICAR body, expect **422 "This document is no longer available."** and the object gone from
the bucket. For an ordinary PDF, expect **200** with a signed URL that serves the exact bytes
uploaded.

⚠️ **Assert the EICAR payload is 68 bytes before sending it.** A 67-byte near-miss is not EICAR and
clamd correctly calls it clean, which looks identical to a broken scanner. This cost real time in
Phase 42; the check is baked into the verification script.

**Confirm the object really left the bucket** with a `HeadObject` — `scanStatus = INFECTED` is a
database claim, not storage evidence.

```bash
cd backend && npx jest src/documents --runInBand    # 37 tests
```

**Verified live on production, 18 Aug 2026:**

| Check | Result |
|---|---|
| 7 pre-existing rows | `PENDING_SCAN` → **all 7 `CLEAN`** |
| EICAR via real presigned flow | refused before scan (*still processing*) → `INFECTED` within 30s → *no longer available*; **no URL issued at any point** |
| Infected object in R2 | **gone**, confirmed by `HeadObject` |
| Clean PDF | `CLEAN` within one cycle, gate opened, served bytes byte-identical to upload |
| Audit row | `Eicar-Test-Signature`, outcome *"stored briefly via presigned upload, then deleted"* |
| Stuck rows | 0 |

9/9 endpoint, 2/2 storage, 12/12 audit + cleanup. Backend suite **1507/1507**.

## 7. Known limitations

### ⚠️ The guarantee here is weaker than every other upload route

State this accurately whenever it comes up. The two are **not** equivalent:

| | |
|---|---|
| **Every other route** (receipts, visa, admission, HR, LIA, INZ, tickets, photos, marketing, importers, cover images) | The file is held in memory, scanned, and refused. **An infected file is never stored.** Nothing exists to clean up. |
| **Case documents (this phase)** | The browser PUTs to R2 before the backend can see anything. **An infected file IS stored, briefly, then deleted.** |

The window is bounded by one poll cycle (15s) plus fetch-and-scan time — in the live test the
verdict landed within 30 seconds, `scanAttempts = 1`. Throughout that window the object is
unreachable: the bucket is private (§9), no public domain is bound to it, and the only way to
obtain a URL is `getDownloadUrl`, which refuses anything not `CLEAN`. So the real exposure is
"bytes at rest in a private bucket for a few seconds", not "a malicious file anyone could fetch".

This is an **accepted, understood consequence of presigned-direct upload**, not a bug. The audit
event says `"stored briefly via presigned upload, then deleted"` rather than the
`"rejected — not stored"` the in-handler routes write, and a test fails if that wording ever drifts
toward implying parity. Do not describe this route as giving the same guarantee as the others.

**Other limitations**

- **A failed R2 delete leaves the object in place.** The row is still marked `INFECTED` (so the
  download gate refuses it) and the audit records *"DELETE FAILED, object may remain"*, but nothing
  retries the deletion. A grep of that audit event is currently the only way to find such a case.
- **No cleanup of orphaned objects generally.** Deleting a `Document` row does not delete its R2
  object; unchanged from before this phase.
- **A stuck document is logged, not alerted.** Ten consecutive failures write one
  `CASE_DOCUMENT_SCAN_STUCK` audit event and one warning log line. There is no paging — by design,
  since a stuck document is unreachable rather than exposed.
- **A missing object parks the row permanently** as `SCAN_ERROR` with `scanAttempts` pushed past
  the threshold, so it is not retried forever against something that will never exist. It will
  never become downloadable; re-upload is the remedy.
- **Polling is not instant.** Up to 15s before a document is even looked at. Users see *"still
  being processed"* in that window — acceptable at current volume, and §8 covers what to do if it
  is not.
- **Large documents are read fully into memory** to be scanned. The largest existing object is
  ~4 MB; there is no cap on this path because there is no interceptor, and a very large document
  would be held in memory for the duration of its scan.
- **One residual from Phase 0 that cannot be checked from the API:** whether a Cloudflare public
  dev URL (`*.r2.dev`) or custom domain is bound to the bucket. That lives in the Cloudflare
  dashboard under R2 → bucket → Settings → Public access. Everything testable says the bucket is
  private, but if that toggle is ever switched on, the download gate stops being the only door and
  this design needs the staging-prefix approach instead.

## 8. How a future developer would extend this

### Tuning the poll

Both knobs are constants at the top of `document-scan.service.ts`:

```ts
const BATCH = 10;                  // documents examined per tick
const LOUD_AFTER_ATTEMPTS = 10;    // failures before the stuck alarm fires, once
```

and the interval is the `@Cron('*/15 * * * * *')` expression on `sweep()`.

- **Backlog clearing too slowly** (rows sitting in `PENDING_SCAN` across many ticks): raise
  `BATCH` before shortening the interval. A tick that overruns is already handled — the `running`
  flag makes the next tick skip rather than queue — so a larger batch is the safer lever.
- **Latency too visible to users** ("still being processed" showing too often): shorten the
  interval. Below ~5s you are mostly paying for empty queries; that is the point to consider
  events instead.
- Do **not** raise `BATCH` far without thinking about memory: each document is read fully into a
  buffer to be scanned, so the peak is roughly batch size × document size.

### Replacing polling with R2 events

If volume grows enough that polling is wasteful, the scan logic does not need to change. It is
already isolated:

- `scanPending()` is **public** specifically so something other than the scheduler can drive it.
- `scanOne()` takes a single document row and owns the entire verdict → delete → audit sequence.

An event-driven version would:

1. Configure an R2 event notification on object-create for the `case-documents/` prefix, delivered
   to a queue or a webhook endpoint on the backend.
2. Have that handler look up the `Document` by `r2Key` and call the same per-document path.
3. **Keep the poll as a safety net**, on a much longer interval (say 5 minutes). Event delivery is
   at-least-once and occasionally not-at-all; a row that never received its event would otherwise
   sit in `PENDING_SCAN` forever, and the existing query already finds exactly those rows. Deleting
   the poll entirely trades a known cost for an invisible failure mode.

Whatever drives it, **do not add a second scanning implementation.** Everything goes through
`AntivirusService`, and a test asserts this file contains no socket or INSTREAM code of its own.

### Adding a new scan state

If a state is ever added (say `QUARANTINED`), the download gate is written as "refuse anything not
`CLEAN`" rather than "refuse this list", so a new state is refused by default. That is the correct
direction — extend the gate's *messages*, never its allow-list.

## 9. Security layers applied

**Layer 7 — File uploads.** The substance of this phase.

- **Private bucket, verified rather than assumed (Phase 0, 7/7).** Unauthenticated GET of a real
  object → HTTP 400 `InvalidArgument` with a 113-byte error body and no object bytes;
  unauthenticated listing → HTTP 400, no key names; **tampered signature → 403**; **expired
  signature → 403**; a valid presigned URL → 200. The endpoint host is the private S3 API, not an
  `r2.dev` public host, and no public URL is constructed anywhere in the codebase — `Document`
  stores an opaque `r2Key` and the list endpoints deliberately never surface it. The first probe
  asserted 401/403 and R2 answers 400, so it was re-run comparing the response body against the
  real object: *refused* has to mean *served no bytes*, not merely *non-200*.
- **The download gate** (`getDownloadUrl`) refuses any document that is not `CLEAN`. This is what
  makes after-the-fact scanning safe: combined with the private bucket, an unscanned or infected
  document is unreachable no matter how long the verdict takes. Three distinct, non-technical
  messages — *still being processed* / *no longer available* / *try again shortly* — because
  "wait" and "this is gone" are different facts a person can act on. None mentions a scanner, and
  a test asserts all three are distinct and none leaks the words scan/virus/malware/signature.
- **Scanning via the shared service.** `AntivirusService.scanBuffer`, the same one all 22 other
  routes use. No second implementation, pinned by test.
- **Fail-closed, expressed for a job rather than a request.** There is no HTTP response to refuse,
  so the equivalent is: a scanner outage leaves the row `SCAN_ERROR`, which is **not**
  downloadable and **is** retried on the next tick. The retry mechanism is the query itself
  (`scanStatus IN (PENDING_SCAN, SCAN_ERROR)`), and a test asserts that query still selects
  `SCAN_ERROR` — if it stopped, stuck rows would silently never be revisited.
- **Deletion is the mitigation, and it is checked.** An infected object is deleted from R2 before
  the row is updated; if the delete fails the row is still marked `INFECTED` so the gate holds, and
  the audit says the object may remain rather than reporting a clean removal.

**Layer 6 — Audit log.** Three events, all on the existing `AuditLog` table:
`CASE_DOCUMENT_REJECTED_MALWARE` (with `signature` and an outcome that states the file was stored
briefly then deleted), `CASE_DOCUMENT_SCAN_ERROR` (object missing from storage),
`CASE_DOCUMENT_SCAN_STUCK` (ten consecutive failures, written **once** — repeating it every tick
would bury the signal it exists to raise). An audit failure is caught and logged and never changes
a verdict already applied, the same rule `UploadScanService` follows.

**Layers 1 & 2 — Auth and role gates.** Unchanged. `getDownloadUrl` still runs
`assertAccess` → `checkCaseDocumentsAccess` before anything in this phase is consulted; the scan
gate sits *after* the access check, so an unauthorised caller is refused before scan state is even
read. The scan-gate spec neutralises access control deliberately, so a failure there can only mean
the scan gate misbehaved.

**Layer 3 — Env vars.** No new variables. **Layer 4 — HTTPS/network:** unchanged; clamd stays on
the private network. **Layer 5 — Rate limiting:** unchanged. **Layer 8 — Auto-logout:** unchanged.
**Layer 9 — npm audit:** no new dependencies. **Layer 10 — DB backups:** four columns on an
existing table, picked up by the nightly backup automatically.

## 10. Rollback instructions

This phase is self-contained. **Nothing below affects the other 22 upload routes** — they scan
in-handler through `UploadScanService` / `AntivirusService` and none of that code is in this
commit.

**Revert the code:**

```bash
git revert 139152b
```

That removes the poll job, the download gate and `getObjectBytes`. Case documents go back to being
served without a scan check; every other route keeps scanning exactly as before.

⚠️ **Revert the code but leave the migration in place.** The columns are additive and harmless
when unread — dropping them buys nothing and loses the verdicts already recorded, including which
documents were found infected. If you truly need them gone:

```sql
ALTER TABLE "documents"
  DROP COLUMN "scanStatus", DROP COLUMN "scanSignature",
  DROP COLUMN "scanCheckedAt", DROP COLUMN "scanAttempts";
DROP TYPE "DocumentScanStatus";
-- and: DELETE FROM _prisma_migrations WHERE migration_name = '20260818030000_document_scan_status';
```

**To stop scanning without reverting anything** — if the job itself is the problem but the gate is
not — comment out the `@Cron` decorator on `sweep()`. ⚠️ Documents then stay `PENDING_SCAN`
forever and the gate refuses them all, so case-document downloads stop working. That is fail-closed
behaving correctly, and it is a considered choice, not a quiet one.

**To open the gate but keep scanning** (the opposite trade — downloads work, verdicts still
recorded), remove only the `if (doc.scanStatus !== DocumentScanStatus.CLEAN)` block in
`getDownloadUrl`. This restores the pre-phase security posture for case documents while leaving the
audit trail intact. Understand what it gives up: unscanned and known-infected documents become
downloadable again.

**Do not** revert `clamav/*` (Phase 42) or the `UploadScanService` work (Phase 41) as part of a
rollback here — this phase depends on the scanner but nothing in those phases depends on this one.
