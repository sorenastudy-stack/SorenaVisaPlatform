# PHASE 5 — Secure Document Upload (Cloudflare R2)

> Handover document. Written so a developer joining in 6 months can read **only this file** and understand the Documents feature completely.
>
> **Status:** ✅ Done and live in production.
> **Live frontend:** https://sorena-visa-platform-aawd.vercel.app
> **Final commits on `main`:** `c1ce3ea` (frontend UI) and `515de2d` (route-collision bugfix).
> **Date completed:** 2026-06-17

---

## 1. What this phase does — plain English

This phase lets staff upload, view, and delete documents (passports, bank statements, PDFs, images) attached to a case. Files are stored securely in **Cloudflare R2** (an object-storage service), not in the database — the database only keeps a record of each file (name, type, size, who uploaded it, which case). Uploads go **directly from the user's browser to R2** using short-lived signed links, so the file bytes never pass through the server. Every upload, download-link issue, deletion, and access denial is recorded in the audit log. The UI lives in the **Documents tab** on the staff case detail page, styled in the navy/gold calm design.

---

## 2. Files created or changed

Repo: `https://github.com/sorenastudy-stack/SorenaVisaPlatform`. Paths relative to repo root.

### Backend (NestJS — Railway)

| File | Purpose |
|------|---------|
| `backend/src/common/r2/r2.service.ts` | `R2Service` — the connection to Cloudflare R2. Reads four env vars (fail-fast if missing), builds one S3 client, and exposes `getPresignedUploadUrl`, `getPresignedDownloadUrl`, `deleteObject`, and a `bucketName` getter. |
| `backend/src/common/r2/r2.module.ts` | Wraps and exports `R2Service` so other modules can use it. |
| `backend/src/documents/documents.controller.ts` | The five HTTP routes (see §3). Prefix `@Controller('cases')`, guarded by `JwtAuthGuard`. |
| `backend/src/documents/documents.service.ts` | Core logic: access checks, presigned URL generation, DB rows, audit writes. |
| `backend/src/documents/documents-access.helper.ts` | The access-control rules (who can read/write/delete — see §9). |
| `backend/src/documents/dto/request-upload.dto.ts` | Validates the upload request (MIME whitelist, 15 MB cap). |
| `backend/src/documents/documents.module.ts` | Wires the module; imports `PrismaModule` + `R2Module`. |
| `backend/src/app.module.ts` | Registers `DocumentsModule`. **Order matters** — see §7 (the route-collision gotcha). |
| `backend/prisma/schema.prisma` | The `Document` model + `DocumentUploadStatus` enum (added in the Phase-5 prep step). |

### Frontend (Next.js — Vercel)

| File | Purpose |
|------|---------|
| `frontend/src/components/staff/cases/detail/CaseDocumentsPanel.tsx` | The Documents tab UI: upload button, file list, View/Remove buttons, delete confirmation, loading/empty/error states. |
| `frontend/src/components/staff/cases/detail/CaseDetailClient.tsx` | Wires the panel into the Documents tab (replaced an empty placeholder). |
| `frontend/src/i18n/messages/en.json` + `fa.json` | English + Persian UI strings for the feature. |

---

## 3. Database tables/columns added & the API

### `documents` table (model `Document`)

| Column | Type | Meaning |
|--------|------|---------|
| `id` | text (cuid) | Primary key. |
| `caseId` | text FK → `cases.id` | Which case this file belongs to. `ON DELETE CASCADE`. |
| `uploaderId` | text FK → `users.id` | Who uploaded it. `ON DELETE RESTRICT`. |
| `r2Key` | text, unique | The object's key (path) inside the R2 bucket. Never sent to the client. |
| `originalName` | text | The filename the user uploaded. |
| `mimeType` | text | e.g. `application/pdf`. |
| `sizeBytes` | int | File size. |
| `status` | enum `DocumentUploadStatus` | `PENDING` → `UPLOADED` → (`FAILED`). |
| `category` | text, nullable | Optional label (unused at launch). |
| `createdAt` / `updatedAt` | timestamp | Standard. |

Indexes: `caseId`, `uploaderId`, `status`, and unique on `r2Key`.

Enum `DocumentUploadStatus`: `PENDING` (row created, file not yet confirmed in R2), `UPLOADED` (browser confirmed upload finished — the only status shown in the list), `FAILED` (reserved; not currently set by any endpoint).

> Note: the enum is named `DocumentUploadStatus`, **not** `DocumentStatus`, because a legacy `DocumentStatus` enum already exists for the unrelated `ApplicationDocument` table. Don't confuse the two.

### The five endpoints (all under `/cases/:caseId/documents`, JWT-guarded)

1. `POST .../request-upload` — body `{ originalName, mimeType, sizeBytes }`. Checks access + MIME whitelist (`application/pdf`, `image/jpeg`, `image/png`) + 15 MB cap. Creates a `PENDING` row, returns `{ documentId, uploadUrl, r2Key, expiresInSeconds: 300 }`.
2. `POST .../:documentId/confirm` — flips the row to `UPLOADED`, writes a `DOCUMENT_UPLOADED` audit row.
3. `GET .../` — lists `UPLOADED` docs for the case (newest first). Returns name, type, size, uploader name, date. Never returns `r2Key`.
4. `GET .../:documentId/download-url` — returns a 5-minute signed download link; writes a `DOCUMENT_DOWNLOAD_URL_ISSUED` audit row.
5. `DELETE .../:documentId` — deletes from R2, then the DB row; writes a `DOCUMENT_REMOVED` audit row. Staff/admin only.

**Upload flow (Option A, presigned):** browser calls `request-upload` → browser uploads file bytes directly to R2 via the returned `uploadUrl` (a raw `PUT`, no JWT, only `Content-Type` header) → browser calls `confirm`. The server never handles the file bytes.

---

## 4. Environment variables added

Four, all on the **backend** service in Railway (names only):

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `R2_BUCKET_NAME`

> ⚠️ **Gotcha (cost us real time — see §7):** these values are sensitive to stray spaces / line breaks when pasted into Railway. If any value has a trailing space or hidden newline, `R2Service` reads it as empty and the **entire backend crashes on boot** with `R2_ACCESS_KEY_ID is not set`. Always set them via Railway's **Raw Editor**, and remember Railway **stages** variable changes — you must click **Deploy** for them to take effect.

---

## 5. Third-party services connected

| Service | Role | Where to manage |
|---------|------|-----------------|
| **Cloudflare R2** | Stores the actual files. Bucket: `sorena-documents` (public access **disabled**). | Cloudflare dashboard → R2 → `sorena-documents`. |
| R2 API token | Lets the backend talk to the bucket. Scoped to **Object Read & Write** on `sorena-documents` only. | Cloudflare → R2 → Manage API Tokens. |

**R2 CORS policy** (bucket → Settings → CORS Policy) — required so the browser can upload directly. Currently allows `PUT` + `GET` with `Content-Type` from these origins:
- `https://sorena-visa-platform-aawd.vercel.app`
- `https://www.sorenavisa.com`
- `https://sorenavisa.com`

> If uploads ever fail at the browser with a CORS error, the origin isn't in this list. Add it here.

---

## 6. How to test it works (manual test)

1. Sign in as a staff/OWNER account → open a case (e.g. Marcus Lee) → click the **Documents** tab.
2. Empty state shows "No documents uploaded yet" + navy "Upload document" button.
3. Click **Upload document**, pick a PDF/JPG/PNG under 15 MB. Expect "Uploading…" then "Uploaded ✓", and the file appears in the list (name, size, uploader, date).
4. Click **View** → the PDF opens in a new tab (signed link, ~5 min).
5. Click **Remove** → confirm dialog → "Yes, remove it" → row disappears, "Document removed."
6. Negative tests: a `.txt` file → "Please choose a PDF, JPG, or PNG file." A >15 MB file → "That file is too large…". Neither attempts an upload.

✅ All verified live on 2026-06-17.

---

## 7. Known limitations & the two gotchas we hit

**Gotcha 1 — env var formatting crashes the whole backend.** Because `R2Service` fail-fasts on a missing var, a mis-pasted value (trailing space/newline) takes the entire app down on boot, not just documents. Fix: set vars via Raw Editor, then click Deploy. (Documented in §4.)

**Gotcha 2 — route collision.** Two controllers declared `@Controller('cases')` with `@Get(':caseId/documents')`: the new `DocumentsModule` and the legacy `CaseDocumentsModule` (the PR-LIA-5 review surface). Express routes first-match-wins by registration order, so the **old** endpoint was shadowing the new list and returning empty. **Fix:** `DocumentsModule` is now registered **before** `CaseDocumentsModule` in `app.module.ts` (with a comment explaining why). **Do not reorder these two without understanding this**, or the documents list silently breaks again.

**Other limitations:**
- `FAILED` status is defined but never set. Abandoned `PENDING` rows (upload started, never confirmed) are not cleaned up — a future sweep job could mark or delete them.
- No file-content virus scanning. The MIME whitelist + size cap are the only upload filters.
- Migrations don't auto-apply on this project (project-wide known gap) — the `documents` table was created via manual SQL in the Railway Data tab.
- No automated e2e/route test exists, so a route collision like Gotcha 2 wouldn't be caught by the test suite (unit tests bypass routing). A minimal supertest harness is the suggested follow-up.

---

## 8. How a future developer would extend this

- **Add document categories/labels:** the `category` column already exists (nullable, unused). Surface it in `request-upload` and the list UI.
- **Let clients upload from the client portal (Phase 7):** the access helper already permits the owning LEAD/STUDENT to read+write their own case's documents; build a client-side panel pointing at the same five endpoints.
- **Cleanup of abandoned uploads:** add a scheduled job to find `PENDING` rows older than N hours and either mark `FAILED` or delete the (likely nonexistent) R2 object + row.
- **Virus scanning:** insert a scan step between `confirm` and marking `UPLOADED`, or scan on first download.

---

## 9. Security layers applied (from the 10-layer standard)

| Layer | Applied? | Where |
|-------|----------|-------|
| **2. Row-level / role-based access** | ✅ | `documents-access.helper.ts`. **Read/write:** admin tier (OWNER/ADMIN/SUPER_ADMIN), or any of the 4 case slot-holders (lia/owner/support/finance, by userId), or the owning client (role LEAD/STUDENT **and** their userId matches `case.lead.contact.userId`). **Delete:** same minus clients. Anyone else → 403. |
| **6. Audit log** | ✅ | Every confirm (`DOCUMENT_UPLOADED`), download-link (`DOCUMENT_DOWNLOAD_URL_ISSUED`), delete (`DOCUMENT_REMOVED`), **and every 403 denial** (`DOCUMENT_ACCESS_DENIED`) writes an `audit_logs` row with actor, case, and snapshots. |
| **7. File upload safety + signed URLs** | ✅ | MIME whitelist (PDF/JPEG/PNG), 15 MB cap (enforced client- and server-side), bucket public access **disabled**, all access via short-lived (5 min) presigned URLs. |
| **3. Secrets in env vars** | ✅ | R2 keys live in Railway env vars, never in code. |
| **4. HTTPS only** | ✅ | Vercel + Railway + R2 defaults. |

---

## 10. Rollback instructions

1. **Code:** revert the two commits:
   ```bash
   git revert 515de2d   # route-collision fix
   git revert c1ce3ea   # frontend UI
   git push origin main
   ```
   To fully remove the backend endpoints too, also revert the Step-3 commit `2ef9a1e`, the Step-2 schema commit `1bdc87f`, and the Step-1 commit `899426a`.
2. **Database:** the `documents` table is additive and harmless to leave. To remove it (only if no code references it), run manually in Railway Data tab:
   ```sql
   DROP TABLE IF EXISTS "documents";
   DROP TYPE IF EXISTS "DocumentUploadStatus";
   ```
3. **R2:** the bucket and its files can be left in place. To fully decommission, delete the bucket and revoke the API token in Cloudflare.
4. **Take a database backup first** (Railway → Postgres → Backups) before any destructive step.

> If you revert the frontend but NOT the backend, the endpoints stay live but unused — harmless.

---

## Appendix — commit history for this phase

| Commit | What it did |
|--------|-------------|
| `899426a` | Step 1 — R2 SDK + `R2Service`/`R2Module` (dormant). |
| `1bdc87f` | Step 2 — `Document` table + `DocumentUploadStatus` enum (migration applied manually). |
| `2ef9a1e` | Step 3 — the five endpoints + access control + audit logging + tests. |
| `c1ce3ea` | Step 4 — frontend Documents tab UI (upload/list/view/delete). |
| `515de2d` | Bugfix — register `DocumentsModule` before `CaseDocumentsModule` to win the route collision on `GET /cases/:caseId/documents`. |

---

*Stack: Next.js (Vercel) + NestJS (Railway) + Railway Postgres/Prisma + Cloudflare R2. Not Supabase. Admin/OWNER: `yashoue@gmail.com`.*
