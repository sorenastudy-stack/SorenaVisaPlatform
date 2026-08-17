# Phase 41 — Antivirus, slice 2: every in-handler upload point

**Status:** DONE — 18 August 2026
**Commit:** `c92d1e3`
**Follows** [PHASE_40](PHASE_40_ANTIVIRUS_SLICE1_PAYMENT_RECEIPTS.md), which scanned payment receipts only.

---

## 1. What this phase does

Every upload that reaches the backend as multipart is now scanned for malware before it is
stored — twenty-one routes covering case and student visa documents, admission documents, INZ
receipts, HR contracts, LIA licence files, ticket attachments, staff photos, provider marketing
files, the provider and staff spreadsheet importers, and programme cover images. They all go
through the same `scanOrReject()` gate that was proven on payment receipts in slice 1, extracted
into one shared service so there is a single copy of the fail-closed logic rather than
twenty-two.

Eight of those routes previously used multer's `diskStorage`, meaning the file was already
written to the volume before any handler code ran; they now use `memoryStorage()`, so a refused
upload leaves the filesystem exactly as it found it. Eleven routes had no size cap at the
multipart boundary at all and now do.

One upload path is deliberately **not** covered: the R2 presigned flow for case documents, where
the browser PUTs straight to Cloudflare and the backend never holds the bytes. See §7.

## 2. Files created or changed

30 files, +1246 / −258.

**Created**
| File | Purpose |
|---|---|
| `backend/src/common/antivirus/upload-scan.service.ts` | **The gate.** `scanOrReject(files, ctx)` — scans, audits, and throws. Also holds the macro-format refusal and the all-or-nothing batch contract. |
| `backend/src/common/antivirus/eicar-routes.spec.ts` | The 22-route EICAR matrix that replaces slice 1's pinning test. |

**The shared helper's contract.** Callers pass bytes and context; they get silence or an
exception. No caller writes a `try`/`catch` around a scan, re-declares the verdict shape
(`ScanVerdict` is imported from `antivirus.service.ts`), or interprets a verdict. There is no
return value to misread, so a handler that forgets to `await` gets an unhandled rejection rather
than a silent pass. The multi-file loop is present and unused — no endpoint sends batches today,
and the first one that does inherits all-or-nothing rather than inventing it.

**diskStorage → memoryStorage (7 routes / 8 handlers).** Each needed a service change too, since
they all relied on multer having written the file: `fs.rename(file.path, dest)` became
`fs.writeFile(dest, file.buffer)` after a clean verdict, and the now-dead `unlinkSilently(file.path)`
cleanup calls were removed (14 of them across three services).

| Controller | Service |
|---|---|
| `backend/src/cases/visa/visa.controller.ts` | `backend/src/cases/visa/visa.service.ts` |
| `backend/src/students/visa/visa.controller.ts` (×2 routes) | `backend/src/students/visa/visa.service.ts` |
| `backend/src/students/admission/admission.controller.ts` | `backend/src/students/admission/admission.service.ts` |
| `backend/src/cases/inz-submission/inz-submission.controller.ts` | `backend/src/cases/inz-submission/inz-submission.service.ts` |
| `backend/src/staff/hr/staff-hr-admin.controller.ts` | `backend/src/staff/hr/staff-hr.service.ts` |
| `backend/src/staff/lia-profiles/lia-profiles.controller.ts` | `backend/src/staff/lia-profiles/lia-profiles.service.ts` |

**Wired, already memoryStorage (14 routes)**
- `backend/src/staff/tickets/staff-tickets.service.ts` — ticket attachment
- `backend/src/staff/photos/staff-photo.service.ts` — both photo routes, via the shared
  `store()`. Gained an `uploaderId` parameter so an admin's refused upload is attributed to the
  admin, not to the staff member it was being set on.
- `backend/src/provider-portal/provider-marketing.service.ts` — marketing file
- `backend/src/providers/providers.service.ts` — programme cover image, and `importProgrammes`
- `backend/src/providers/import/pricing-import.service.ts` — `importTuitions`, `importScholarships`

**The two shared importer call sites, and why they are where they are.** Nine importer routes —
six provider (`{programmes,tuition,scholarships}` × `{check,apply}`) and three staff — funnel into
three service methods. Scanning at the outer `ProviderImportService.run()` *and* in those methods
would have scanned every provider upload twice. The scan therefore lives at the innermost shared
point: `ProvidersService.importProgrammes` (3 routes) and `PricingImportService.importTuitions` /
`importScholarships` (6 routes). Each upload is scanned exactly once, whichever door it came in.
`ProviderImportService.run()` carries a comment saying so, because "why is there no scan here"
is the obvious question a future reader will have.

`importProgrammes` gained a fourth parameter, `actorId`, so a refusal on the staff route names
who sent the file; both call sites pass it.

⚠️ **Placement matters more than presence here.** All three importer methods wrap their parse in
a `catch` that rewrites any error into `"Could not read the spreadsheet"`. A scan placed inside
that block would have converted a scanner outage into a 400 about file format — fail-closed
still technically working, but reported as the user's problem and invisible in the logs. Every
importer scan sits **outside** those blocks, with a comment saying why.

**Interceptor size caps added (11 routes, previously uncapped)**
| File | Routes | Cap | Matches |
|---|---|---|---|
| `backend/src/provider-portal/provider-marketing.controller.ts` | 1 | 20 MB | the service's `MAX_BYTES` |
| `backend/src/provider-portal/provider-import.controller.ts` | 6 | 5 MB | `assertProviderFile` |
| `backend/src/providers/providers.controller.ts` | 3 sheets | 5 MB | the importers' `MAX_BYTES` |
| `backend/src/providers/providers.controller.ts` | 1 cover image | 2 MB | `setProgrammeCoverImage` |

No cap anywhere now exceeds 20 MB, which keeps clear margin under clamd's `StreamMaxLength`
(stock default 25 MB) so no accepted file can be too large to scan. That default is still
implicit — pinning it explicitly is part of the clamd hardening in §7.

**Macro-capable Office formats** (`.docm/.dotm/.xlsm/.xltm/.xlam/.pptm/.potm/.ppsm`) are refused
by extension **and** by mime, since either check alone is trivially defeated: a `.xlsm` renamed
to `.xlsx` keeps its macro-enabled mime, and a spoofed mime keeps the telltale extension.

Applied on: the six provider importers, the three staff importers, **and admission documents**.
Admission was not on the original list but accepts
`application/vnd.openxmlformats-officedocument.wordprocessingml.document` — it accepts an Office
format, so the brief's own rule ("every endpoint that accepts Office-format documents at all")
covers it. Its mime whitelist would refuse a macro-enabled *mime*, but not a `.docm` renamed to
`.docx` and sent with a spoofed content type.

**Not applied on HR contracts**, despite being on the original list: that route's whitelist is
`application/pdf` and nothing else. It accepts no Office format, so there is nothing for the
block to refuse. Image-only and PDF-only surfaces (visa, INZ, LIA, tickets, photos, marketing,
cover images) are n/a for the same reason.

**Test files updated for the new constructor arity** — clean-verdict stubs, no behaviour change:
`providers/provider-status-audit.spec.ts`, `providers/providers.scholarships.spec.ts`,
`staff/lia-profiles/lia-profiles.service.spec.ts`. The LIA spec also had two assertions that
multer's temp file had been consumed (`expect(fs.existsSync(file.path)).toBe(false)`); under
`memoryStorage` no temp file is ever created, so those now assert the *stored* file holds the
uploaded bytes — the thing that actually matters.

`backend/src/common/antivirus/antivirus.service.spec.ts` — the slice-1 pinning block was removed
and replaced with a note explaining what replaced it and why. The 15 protocol/fail-closed tests
above it are untouched.

**The guard-by-name fix, worth recording as a near-miss.** The matrix's first version resolved
its guard overrides by path inside a `try`/`catch`. One path was wrong, the `catch` swallowed it,
`EngagementPaidGuard` stayed active, and five routes answered 403 without ever reaching the
scanner. Because the assertion is exact (§6) the suite went red rather than green — but a
looser assertion plus that swallow would have shipped five unverified routes looking verified.
The guards are now imported by name, so a wrong path is a loud import error.

`backend/package.json` / `package-lock.json` — added `supertest` + `@types/supertest` (dev only).

## 3. Database / config changes

**None. No migration, no schema change.** Nothing was added to `schema.prisma`; `npx prisma
migrate status` is unchanged by this phase. Neither the size caps nor the macro block needed
storage — both are request-time checks.

Two new audit event *shapes* are written to the existing `AuditLog` table, per surface, derived
from the `surface` string each caller passes:

- `<SURFACE>_REJECTED_MALWARE` — `fileName`, `mimeType`, `sizeBytes`, `signature`, `batchSize`,
  `outcome: "rejected — not stored"`
- `<SURFACE>_REJECTED_SCANNER_UNAVAILABLE` — `fileName`, `reason`, `batchSize`, `outcome`

Surfaces in use: `CASE_VISA_DOCUMENT_UPLOAD`, `STUDENT_VISA_SUPPORTING_DOCUMENT_UPLOAD`,
`STUDENT_VISA_OTHER_EVIDENCE_UPLOAD`, `ADMISSION_DOCUMENT_UPLOAD`, `INZ_RECEIPT_UPLOAD`,
`HR_CONTRACT_UPLOAD`, `LIA_LICENCE_FILE_UPLOAD`, `TICKET_ATTACHMENT_UPLOAD`,
`STAFF_PHOTO_UPLOAD`, `PROVIDER_MARKETING_UPLOAD`, `PROGRAMME_IMPORT_UPLOAD`,
`TUITION_IMPORT_UPLOAD`, `SCHOLARSHIP_IMPORT_UPLOAD`, `PROGRAMME_COVER_IMAGE_UPLOAD`.
Slice 1's `RECEIPT_UPLOAD_REJECTED_*` events are unchanged.

## 4. Environment variables added

**None.** This phase reuses slice 1's `CLAMAV_HOST` and `CLAMAV_PORT` on the backend service, and
the optional `CLAMAV_TIMEOUT_MS` (default 20000, still unset in production). Confirmed: no new
variable is read anywhere in this phase's diff.

⚠️ The slice-1 warning now applies twenty-two times over: **unsetting `CLAMAV_HOST` does not
disable scanning.** It makes every scan return UNAVAILABLE, and because the design fails closed,
*every upload on the platform* would be refused — not just receipts. See §10.

## 5. Third-party services connected

**None new.** The same `clamav` service on Railway (`peaceful-imagination` → production), stock
`clamav/clamav:stable`, reachable only at `clamav.railway.internal:3310` on the private network.
No public domain, no ingress. Slice 2 added callers, not infrastructure.

## 6. How to test it works

**EICAR** is the industry-standard antivirus test file — a harmless 68-byte ASCII string every
scanner is required to detect. It is not malware.

**Manually, on any of the 21 routes.**

1. Create a file containing exactly:
   `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`
2. Save it with an extension the target route accepts (`.pdf` for documents, `.png` for photos
   and cover images, `.xlsx` for importers) and upload it through the normal UI.
3. **Expect HTTP 422** and *"This file could not be uploaded. Please try a different file."* —
   no mention of a virus, a signature, or a scanner.
4. Confirm nothing was stored: no new row for that document/asset, and nothing new under
   `/data/uploads/` or in the R2 bucket.
5. Confirm an `AuditLog` row exists with `eventType = '<SURFACE>_REJECTED_MALWARE'` naming the
   uploader and the signature.

**The clean control — do this too.** Upload an ordinary file of the same type to the same route
and confirm it is **accepted**. Without this step, an upload path that is simply broken looks
identical to one that is correctly refusing malware.

**The macro-format check.** Upload a `.xlsm` to any importer. Expect **415** and *"Macro-enabled
Office files are not accepted…"* — a different status and a plainer message than a detection,
because here there is nothing to withhold and the person needs to know what to do.

**The automated matrix.**

```bash
cd backend
npx jest src/common/antivirus --runInBand      # 34 tests: 15 protocol + 22 routes + controls
```

`eicar-routes.spec.ts` boots the real `AppModule` and POSTs a real EICAR file at all 22 routes
through real HTTP. The only substitution is clamd itself — a local TCP server speaking real
INSTREAM that answers FOUND for EICAR and OK otherwise, so the framing, reply parsing and
fail-closed logic all stay under test.

Two things about it are load-bearing:

- **Auth guards are forced open.** Not a shortcut — it is what makes the result meaningful. With
  guards live, a mis-seeded fixture answers 401/403 and a test asserting "not 2xx" passes while
  never reaching the scanner. With them open, only the scan path can produce the rejection.
- **The assertion is exact** — status `422` *and* the precise sentence, plus measured
  before/after deltas across nine tables, files on disk, and R2 puts. "Some 4xx" would be
  satisfied by a validation error, a missing fixture, or a renamed route. This caught five routes
  answering 401/403/400 while never reaching the scanner.

A route that cannot be exercised **fails**; it is never skipped. That is the signal a route needs
different treatment, and a silent skip would bury it.

**Verified 18 Aug 2026:** matrix 24/24 (22 routes + a route-count guard + the clean-file
control). Falsification: removing the scan from `staff-photo.service.ts` turned the matrix red on
exactly those two routes and left the other twenty green; restored, green again. Full backend
suite **1489/1489**. Clean `nest build`.

## 7. Known limitations

- **The R2 presigned case-document flow is NOT covered.**
  `backend/src/documents/documents.service.ts` — `POST /cases/:caseId/documents/request-upload` →
  browser PUTs straight to R2 → `/confirm`. The backend never holds the bytes, so there is
  nothing to scan in a handler and bolting a scan onto the presign endpoint cannot work. **7
  `UPLOADED` rows already exist in production, unscanned.** This is the one gap the guard test
  cannot detect: the matrix fails loudly when a *named in-handler route* stops scanning, and this
  flow has no such route to name. It needs a staging prefix, a scan job, an `AVAILABLE` gate on
  the download endpoint, and a backfill of the 7 — deferred to its own pass by explicit decision.
- **clamd is still stock.** `AlertEncrypted` (reject password-protected archives and documents
  rather than passing them as clean), `ScanOLE2` plus macro heuristics, and an explicit
  `StreamMaxLength` are all unset — the service runs `clamav/clamav:stable` with default
  settings. The agreed fix is a `clamav/Dockerfile` in this repo carrying our own `clamd.conf`,
  with the Railway service repointed from image-deploy to repo-deploy. Not started. Until then
  the app-layer macro block is doing that work alone, and it checks names and mimes, not
  container contents.
- **No volume on the clamav container**, so signatures re-download on every deploy and there is a
  short boot window running the image's baked-in database. `freshclam` egress works — verified
  `daily.cld` updating 28087 → 28095.
- **Scanning is synchronous** and adds a few hundred milliseconds to every upload. Fine at
  current volumes; worth re-measuring if a bulk path appears.
- **No quarantine and no staff visibility.** Refused files are deleted, not preserved, and the
  rejections live in the audit log with no screen surfacing them.
- **No cleanup job for orphaned stored files** — unchanged from slice 1.
- **Uploads now buffer in memory.** `memoryStorage` holds the whole file in RAM for the request's
  life. Bounded by the caps in §2 (20 MB worst case), which is why every route having an explicit
  cap mattered more here than it did before.

## 8. How a future developer would extend this

Adding a new upload endpoint safely — four things, in order:

1. **`memoryStorage()` only.** Never `diskStorage`, never a `dest:` option. `diskStorage` writes
   the file before your handler runs, which is the thing this phase spent most of its effort
   undoing. The helper treats a file with no `.buffer` as UNAVAILABLE and refuses it, so a route
   wired to disk storage fails closed rather than silently skipping the scan — but it fails at
   runtime, not at review.
2. **Declare a size cap on the interceptor.** `limits: { fileSize: N }`, matching whatever the
   service enforces, never above 20 MB.
3. **Call the shared gate**, after the cheap checks (ownership, state, type) and before the first
   write of any kind — disk, R2, database row, or queue payload:

```ts
constructor(private readonly uploadScan: UploadScanService) {}   // @Global, no module import

await this.uploadScan.scanOrReject(file, {
  userId,
  surface:    'MY_NEW_SURFACE_UPLOAD',
  entityType: 'MyEntity',
  entityId:   id,
  blockOfficeMacros: true,   // only if the route accepts Office formats at all
});
```

   Check the surrounding code for a broad `catch` before choosing the line to put it on — see the
   importer trap in §2. If an existing `try` block would swallow a `ServiceUnavailableException`,
   the scan goes above it.

4. **Add the route to `ROUTES` in `eicar-routes.spec.ts`** and bump the expected count in the
   `covers every route named in this slice` test. This is not optional bookkeeping: the count
   assertion fails if you add a route without registering it, which is the point. If the new
   route cannot be exercised by the matrix, that is the signal it needs the R2-pipeline treatment
   rather than in-handler scanning — report it, do not skip it.

Never add a "skip scanning" flag. See §10.

## 9. Security layers applied

- **Layer 1 — Auth.** Unchanged. Every route touched keeps its existing `JwtAuthGuard`; no
  endpoint's authentication was altered. The matrix overrides guards *in tests only*.
- **Layer 2 — Role gate.** Unchanged. `RolesGuard`, `StaffRolesGuard`, `CaseAccessGuard`,
  `EngagementPaidGuard` and `ProviderAccessGuard` all still apply exactly as before, and the scan
  runs after them — an upload from someone with no business on the record is refused before it is
  ever scanned.
- **Layer 3 — Env vars.** No new variables. `CLAMAV_HOST` unset means UNAVAILABLE, never CLEAN, so
  a misconfigured backend refuses uploads rather than accepting them unscanned.
- **Layer 4 — HTTPS.** No change; Railway terminates TLS. clamd traffic never leaves the private
  network.
- **Layer 5 — Rate limiting.** Unchanged. Existing `@Throttle` decorators on the visa, admission,
  photo, marketing and import routes still apply. Worth noting these now matter more: each request
  holds a file in memory and occupies a clamd connection.
- **Layer 6 — Audit log.** Both rejection paths write an `AuditLog` row **before** the exception
  is thrown, so a refusal is recorded even though nothing was stored. A failure to audit is
  logged and swallowed inside the helper — it must never turn a rejection into a success. That is
  the only `catch` in the file, and it is around the audit, never around the scan.
- **Layer 7 — File uploads.** The substance of this phase.
  - *Type whitelists* — unchanged per route, still enforced at multer's `fileFilter`.
  - *Size limits* — now enforced at the interceptor on **every** route; 11 had none.
  - *Malware scanning* — `scanOrReject()` on all 21 routes, positioned after validation and
    before the first write.
  - *Fail-closed* — unreachable, slow, erroring, unparseable, empty, unconfigured, or
    bufferless all resolve to UNAVAILABLE and refuse.
  - *Macro-format rejection* — by extension and mime, on the surfaces that accept Office files.
  - *No temp-file window* — `memoryStorage` everywhere, so a refused file is never written.
  - *Message discipline* — a detection returns only *"This file could not be uploaded…"*; the
    signature goes to the audit log. UNAVAILABLE returns a deliberately different message,
    because that outage is ours and telling someone their file is bad sends them off to re-make
    a file that was fine.
- **Layer 8 — Auto-logout.** No change.
- **Layer 9 — npm audit.** Two dev-only additions (`supertest`, `@types/supertest`). Nothing new
  in the production dependency tree — the clamd client remains hand-written for exactly this
  reason.
- **Layer 10 — DB backups.** No new tables or columns; the nightly backup is unaffected.

## 10. Rollback instructions

**Do not unset `CLAMAV_HOST`.** After this phase that would refuse *every upload on the
platform*, not just receipts. It is the opposite of a bypass.

**There is deliberately no bypass flag.** A "skip scanning" variable is one someone flips during
an incident and forgets, leaving the control silently off while it still appears to be there.

**Revert the phase — the whole of slice 2, leaving slice 1 and the clamav service alone:**

```bash
git revert c92d1e3        # and the handover commit, if reverting the docs too
```

That restores the 21 routes to their pre-phase behaviour, including `diskStorage` on the seven
that used it, and removes `UploadScanService` and the route matrix. It does **not** touch
`portal.service.ts` — the payment-receipt scan from slice 1 is not in this commit and keeps
working, because it calls `AntivirusService` directly rather than through the shared helper.

**Revert one route instead**, which is usually the better move if a single upload path is
misbehaving: delete that service's `await this.uploadScan.scanOrReject(...)` call, remove the
route from `ROUTES` in `eicar-routes.spec.ts`, and drop the expected count by one. The count
assertion is what stops a route being quietly dropped without anyone noticing.

⚠️ **Reverting a diskStorage conversion is not just the controller line.** The seven converted
routes have services that now call `fs.writeFile(dest, file.buffer)`; switching the controller
back to `diskStorage` without restoring `fs.rename(file.path, dest)` leaves `file.buffer`
undefined and the write fails. Revert the controller and its service together, or use
`git revert` and let it handle both.

**The `clamav` Railway service is untouched either way** — no config, image or variable in this
phase. Leave it running: slice 1 still depends on it, and the deferred work in §7 needs it.
