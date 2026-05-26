# PR-LIA-5 — LIA document access + internal review + back-button UX bundle

A unified "All client documents" surface on `/lia/cases/[id]` that finally lets the LIA see every file the client has uploaded across all three source models, download anything that has bytes, and record an internal-only verdict. Plus a tiny shared `BackLink` component used to fix the navigation cul-de-sac on every LIA sub-page.

## 1. What this PR does

Until this PR the LIA could see admission-application documents nested under each `Application` on the case-detail page, but had no way to find visa-stage uploads, no way to download anything without leaving the LIA portal, and no way to record a verdict on a document they'd reviewed. PR-LIA-5 fixes all three in one card: a cross-source listing with download + review.

Three source models are unified behind a `(source, sourceRowId)` composite identifier:

- **`ADMISSION`** — `AdmissionDocument` (has `fileUrl`, downloadable).
- **`APPLICATION`** — `ApplicationDocument` (has `fileUrl` — optional, can be null).
- **`VISA_SUPPORTING`** — `VisaSupportingDocument` (no `fileUrl`, metadata-only per PR-VISA-13/14). Listable but **not downloadable**; the Download button renders as a disabled "Unavailable" pill with a tooltip explaining why.

The user's original spec referenced a fourth source `CASE_MESSAGE_FULFILMENT` and a `VisaCaseFile` model. `VisaCaseFile` doesn't exist in the schema (same finding from PR-LIA-4). `CASE_MESSAGE_FULFILMENT` isn't a separate model — it's a `CaseMessage` row with a FK to a `VisaSupportingDocument`. The canonical document lives in `visa_supporting_documents` either way, so I covered it under `VISA_SUPPORTING` and added a `linkedToRequestMessageId` field on the list response so the UI can surface "this doc fulfilled a PR-LIA-4 document request".

Review verdicts live in a new `CaseDocumentReview` table — decoupled from the source models so we don't have to add columns to three existing upload tables. The unique constraint `(source, sourceRowId)` means a re-review upserts in place; clearing a review deletes the row entirely. `UNREVIEWED` is the implicit default (no row).

**Reviews are internal-only.** The client does not see the LIA's verdict anywhere in their portal — by explicit user decision (Option B). When a re-upload is needed, the LIA messages the client through the PR-LIA-4 case-thread; the verdict stays in the LIA workspace.

A small UX bundle ships alongside: a shared `BackLink` component used on every LIA sub-page that wasn't the dashboard, plus the student-side `/student/case/messages` page. The `/lia/cases/[id]` page keeps its existing "Back to cases" link unchanged per the spec.

No new env vars. No new npm dependencies. One Prisma migration. No file bytes ever proxy through Next.js — downloads are direct from object storage via the existing PR-SEC3 signed-URL endpoint.

## 2. Files changed

Backend (new):
- `prisma/migrations/20260526200000_pr_lia_5_case_document_reviews/migration.sql` — two enums + the `case_document_reviews` table + indexes + FKs.
- `src/case-documents/case-documents.module.ts` — wires `PrismaModule` + `CryptoModule`.
- `src/case-documents/case-documents.controller.ts` — `@Controller('cases')`, class-level `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')`. Four routes (list, download-url, review POST, review DELETE).
- `src/case-documents/case-documents.service.ts` — cross-source list + signed URL + upsert/clear review + ownership-check helpers.
- `src/case-documents/dto/case-documents.dto.ts` — `ReviewDocumentDto` (status enum + reason string, 10–2000).

Backend (existing):
- `prisma/schema.prisma` — `CaseDocumentReviewSource` + `CaseDocumentReviewStatus` enums; `CaseDocumentReview` model; inverse `documentReviews` on `Case`; inverse `documentReviews @relation("CaseDocumentReviewer")` on `User`.
- `src/app.module.ts` — registers `CaseDocumentsModule`.
- `src/common/audit/audit.helper.ts` — two new summarizer cases: `LIA_DOCUMENT_DOWNLOADED`, `LIA_DOCUMENT_REVIEWED` (handles APPROVED / REJECTED / CLEARED).

Frontend (new):
- `src/components/ui/BackLink.tsx` — shared "← {label}" link component.
- `src/app/lia/cases/[id]/DownloadDocumentButton.tsx` — fetches signed URL, opens in new tab. Disabled state for non-downloadable rows.
- `src/app/lia/cases/[id]/ReviewDocumentButton.tsx` — overlay with APPROVE/REJECT toggle, required reason, current-verdict display, "Clear this review" affordance.

Frontend (existing):
- `src/app/lia/cases/[id]/page.tsx` — new "All client documents" card between Applications and Contract; adds `CaseDocumentRow` type + `sourceLabel` + `ReviewStatusBadge` helpers.
- `src/app/lia/cases/page.tsx` — `BackLink` to `/lia`.
- `src/app/lia/decisions/page.tsx` — `BackLink` to `/lia`.
- `src/app/lia/documents/page.tsx` — `BackLink` to `/lia`.
- `src/app/lia/productivity/page.tsx` — `BackLink` to `/lia`.
- `src/app/student/case/messages/page.tsx` — replaced its inline back link with the shared `BackLink`, redirected target from `/student/case` to `/student` per the spec.

No new npm dependencies, no new env vars.

## 3. Schema added

```prisma
enum CaseDocumentReviewSource {
  ADMISSION
  APPLICATION
  VISA_SUPPORTING
}

enum CaseDocumentReviewStatus {
  APPROVED
  REJECTED
}

model CaseDocumentReview {
  id              String                     @id @default(uuid())
  caseId          String
  source          CaseDocumentReviewSource
  sourceRowId     String
  status          CaseDocumentReviewStatus
  reasonEncrypted Bytes
  reviewedById    String
  reviewedAt      DateTime                   @default(now())

  case            Case                       @relation(fields: [caseId], references: [id], onDelete: Cascade)
  reviewedBy      User                       @relation("CaseDocumentReviewer", fields: [reviewedById], references: [id])

  @@unique([source, sourceRowId])
  @@index([caseId, reviewedAt])
  @@map("case_document_reviews")
}
```

Migration (`20260526200000_pr_lia_5_case_document_reviews/migration.sql`) creates the two enums, the table with three indexes (PK, unique `(source, sourceRowId)`, timeline `(caseId, reviewedAt)`), and two FKs (case CASCADE, reviewer NO ACTION). No backfill — `UNREVIEWED` is the implicit default.

**Why `(source, sourceRowId)` instead of a typed FK.** Three source tables. Pointing the review at a single FK would require three nullable columns or a polymorphic id; both are uglier than the simple `(source, sourceRowId)` composite. The upsert flow uses `where: { source_sourceRowId: { source, sourceRowId } }`, which Prisma derives from the compound `@@unique`.

## 4. Endpoint contract

All four routes are mounted at `/cases/:caseId/documents`, guarded by `JwtAuthGuard + RolesGuard`, role-gated to `LIA / ADMIN / SUPER_ADMIN / OWNER`.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/cases/:caseId/documents` | — | Cross-source list, oldest-first by `uploadedAt DESC`. Includes joined review state. |
| GET | `/cases/:caseId/documents/:source/:sourceRowId/download-url` | — | Returns `{ url: '/files/signed/<token>', expiresInSeconds: 300 }`. Audited. Returns 400 for metadata-only sources (no `fileUrl`). |
| POST | `/cases/:caseId/documents/:source/:sourceRowId/review` | `{ status: 'APPROVED' \| 'REJECTED', reason: string (10–2000) }` | Upsert the review verdict. |
| DELETE | `/cases/:caseId/documents/:source/:sourceRowId/review` | — | Clear the verdict; doc returns to `UNREVIEWED`. |

### Sample response (`GET /cases/:caseId/documents`)

```json
[
  {
    "id": "ADMISSION:cuid1",
    "source": "ADMISSION",
    "sourceRowId": "cuid1",
    "docType": "PASSPORT_COPY",
    "fileName": "passport.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 1240320,
    "uploadedAt": "2026-05-12T03:12:00.000Z",
    "uploadedById": "userCuid",
    "uploadedByName": "Reza Ahmadi",
    "downloadable": true,
    "linkedToRequestMessageId": null,
    "liaReviewStatus": "APPROVED",
    "liaReviewedAt": "2026-05-21T08:01:11.000Z",
    "liaReviewedById": "liaUserCuid",
    "liaReviewedByName": "Aria Karimi",
    "liaReviewReason": "Looks good, matches the application."
  },
  {
    "id": "VISA_SUPPORTING:cuid2",
    "source": "VISA_SUPPORTING",
    "sourceRowId": "cuid2",
    "docType": "BANK_STATEMENT",
    "fileName": "bank-march.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 882043,
    "uploadedAt": "2026-05-20T10:14:00.000Z",
    "uploadedById": "userCuid",
    "uploadedByName": "Reza Ahmadi",
    "downloadable": false,
    "linkedToRequestMessageId": "msgUuid",
    "liaReviewStatus": "UNREVIEWED",
    "liaReviewedAt": null,
    "liaReviewedById": null,
    "liaReviewedByName": null,
    "liaReviewReason": null
  }
]
```

### Sample response (`GET /cases/.../download-url`)

```json
{ "url": "/files/signed/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", "expiresInSeconds": 300 }
```

The frontend prepends `NEXT_PUBLIC_BACKEND_URL` and `window.open()`s the absolute URL in a new tab. The browser handles the inline view / download.

## 5. Authorisation contract

**The `:sourceRowId` is never trusted.** Every endpoint that uses it walks the source table back to the `Case` and confirms `row.caseId === param.caseId`. Mismatch → `404 NOT_FOUND` (not 403 — we don't leak whether the row exists). Specifically:

- `ADMISSION` — `AdmissionDocument` → `AdmissionApplication.caseId`. One include hop.
- `APPLICATION` — `ApplicationDocument` → `Application.caseId`. One include hop.
- `VISA_SUPPORTING` — `VisaSupportingDocument` → `VisaApplication.applicationId` → `AdmissionApplication.caseId`. **Two queries** (the schema has no inverse relation `VisaApplication.application`, only the FK column). Documented in `resolveSourceRow`.

The same resolver fronts every download-URL and review endpoint. A malicious LIA on another case who guesses the right source-row-id cannot read or review someone else's file.

**Reviews are internal-only by hard design.** No backend endpoint exposes `CaseDocumentReview` rows to the student-side `/students/me/*` routes. There is no path where a student can retrieve the verdict. The frontend explicitly states "internal only — the client doesn't see this verdict" in the review overlay so the LIA isn't surprised.

## 6. Download flow

The signed-URL endpoint reuses the existing PR-SEC3 utility:

```ts
import { createSignedDownloadToken } from '../common/signed-url.util';

const token = createSignedDownloadToken({
  fileUrl: row.fileUrl,
  fileName: row.fileName,
  mimeType: row.mimeType,
});
return { url: `/files/signed/${token}`, expiresInSeconds: 5 * 60 };
```

- TTL: 5 minutes (defined in `signed-url.util.ts`).
- Token payload: `{ fileUrl, fileName, mimeType }` — JWT-signed with `JWT_SECRET`.
- Frontend: `window.open(absoluteUrl, '_blank', 'noopener')`. Direct stream from the `/files/signed/:token` route — no Next.js proxy.
- Audit: every download generates one `LIA_DOCUMENT_DOWNLOADED` audit row with `{ source, sourceRowId, fileName }` in `newValue`.

If `row.fileUrl` is null (`VISA_SUPPORTING` rows; some legacy `APPLICATION` rows that pre-date the upload flow), the endpoint returns **400** with the message `"This document is metadata-only — file bytes have not been collected."`. The frontend never calls the endpoint for non-downloadable rows; the disabled "Unavailable" pill is a UX defence on top of the backend guard.

## 7. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **Migration applied:** `npx prisma migrate status` shows `20260526200000_pr_lia_5_case_document_reviews` applied. `\d case_document_reviews` lists the eight columns + the two indexes + two FKs.
3. **Login as an LIA user.** Visit `/lia/cases/<some-case-with-docs>`. The new "All client documents" card appears between Applications and Contract. Empty-state placeholder if the client hasn't uploaded anything.
4. **List populates.** Each row shows doc type, filename, source label, uploaded timestamp, an UNREVIEWED grey badge, and two action buttons.
5. **Download an admission document.** Click Download — a new tab opens; the file streams from `/files/signed/<token>`. `SELECT id, "eventType", "newValue" FROM audit_logs WHERE "eventType" = 'LIA_DOCUMENT_DOWNLOADED' ORDER BY "createdAt" DESC LIMIT 1` shows your row with `{ source: 'ADMISSION', sourceRowId, fileName }`.
6. **Download a visa supporting document.** The Download button is greyed out; tooltip explains "metadata-only".
7. **Approve a document.** Click Review → toggle APPROVE → type 10+ chars → click Approve. The row refreshes with an emerald "Approved" badge. Audit row `LIA_DOCUMENT_REVIEWED` with `{ status: 'APPROVED', source, sourceRowId, reasonLength }` is written.
8. **Edit the verdict.** Re-open Review on the same row. The current verdict + reason are pre-populated. Switch to REJECT, change the reason, Save. The badge flips to red. The audit log shows a second `LIA_DOCUMENT_REVIEWED` row with `oldValue: { status: 'APPROVED', ... }` and `newValue: { status: 'REJECTED', ... }`.
9. **Clear the verdict.** Re-open Review → click "Clear this review". Badge returns to grey UNREVIEWED. Audit row `LIA_DOCUMENT_REVIEWED` with `newValue.status = 'CLEARED'`.
10. **Cross-case attack defence.** As an LIA, hit `GET /cases/<otherCaseId>/documents/ADMISSION/<adocId-on-MY-case>/download-url` — expect `404` (the doc isn't on that case).
11. **Back-button bundle.** Visit `/lia/cases`, `/lia/decisions`, `/lia/documents`, `/lia/productivity`, and `/student/case/messages` — each shows a "← Back to …" link above the page title that returns to the correct destination.
12. **Activity feed summaries.** Open the case audit log (or any consumer of `summarizeAuditEntry`) — the new event types render as `LIA downloaded document: <name>`, `LIA approved a client document`, `LIA rejected a client document`, `LIA cleared a document review`.

## 8. Known limitations

- **Reviews are internal-only by design** — the client never sees the verdict. Per the explicit user decision; revisiting this is PR-LIA-5.1 territory.
- **VisaSupportingDocument bytes were never collected** in the upstream PR-VISA-13/14 design. Those rows show in the list (metadata is still useful) but the Download button is disabled. A future upload PR could backfill bytes; this PR doesn't address that.
- **Some `ApplicationDocument` rows have null `fileUrl`** (the model allows it). The Download button is also disabled for those, with the same tooltip.
- **No file preview pane.** Clicking Download opens a new tab. Inline PDF/image previews would need object-storage CORS + a Next.js viewer component — out of scope.
- **No re-upload from inside the review overlay.** The client must re-upload through their own portal; the LIA sends a message via PR-LIA-4 if needed. The review overlay copy says so explicitly.
- **No LIA-side upload of documents.** The LIA can't attach a sample form or a marked-up version. Separate PR.
- **No versioning.** When a client re-uploads, the old `AdmissionDocument` / `ApplicationDocument` row may be replaced or a new one added depending on the upstream flow. The unified list shows whatever rows currently exist. Reviewing the "old" version doesn't carry forward to the "new" one (each gets its own row keyed by id).
- **No CSV export of the document list.** PR-LIA-12 territory.
- **No bulk approve / reject.** Each row is one click. With single-digit documents per case this is fine; if the LIA workflow grows to dozens of docs per case, a multi-select bar is the natural extension.
- **The composite id `<source>:<rowId>`** is what the frontend uses as the React key. It's stable across renders but is not a real database id — don't pass it back to the backend; use `source` + `sourceRowId` as separate path params.
- **`linkedToRequestMessageId` only surfaces on the JSON shape.** The UI doesn't render it visually yet (e.g. a small "fulfilment of <date>" pill). One-line addition when needed.
- **Audit log doesn't include the IP address** on downloads. The pattern across PR-LIA-1..4 is to leave `ipAddress` null; we'd need a request-scoped helper to populate it consistently.
- **The student-side `/student/case/messages` back link target changed** from `/student/case` to `/student` per the spec. If users were relying on the old behaviour, this is a silent UX shift.

## 9. How to extend

- **PR-LIA-5.1 — client-visible reviews.** Add a `publishToClient: Boolean @default(false)` column on `CaseDocumentReview`. New mutation on the review overlay: "Publish to client". The student dashboard renders a new "Documents" panel showing each doc + its (published-only) verdict + reason. The audit log gains `LIA_DOCUMENT_VERDICT_PUBLISHED`. Decide carefully — once a verdict is published, an LIA can't unsay it.
- **In-browser preview pane.** Wire the signed-URL response into a viewer component (PDF.js for `application/pdf`, plain `<img>` for `image/*`). Needs object-storage CORS allowing `https://app.sorenavisa.com`. Render-in-pane vs new-tab is a UX choice — keep both behind a toggle if uncertain.
- **Bulk actions.** Row checkboxes + a sticky action bar at the bottom of the documents card. New endpoint `POST /cases/:caseId/documents/bulk-review` accepting `{ targets: [{source, sourceRowId}], status, reason }`. Reuse the existing service in a loop inside one `$transaction`.
- **LIA-side document uploads.** New `CaseDocumentReviewSource.LIA_UPLOADED` enum value plus a new upload path on the LIA side. Doesn't fit cleanly in the existing source model — needs its own table or reuse of `ApplicationDocument` with a `uploadedByRole` discriminator.
- **Versioning.** Add `previousVersionRowId String?` on the source upload models. When the client re-uploads, link the new row to the old. The unified list filters out superseded rows by default; an "Show old versions" toggle shows them.
- **Move reviews from internal-only to a tri-state** (`INTERNAL`, `PUBLISHED_OK`, `PUBLISHED_NEEDS_FIX`). Lets the LIA flag "needs fix" to the client without blasting every internal note onto the client portal.
- **Per-document message threads.** Today a review reason is one paragraph. If discussion is needed, the LIA opens the case thread and references the doc. A future PR could add per-document comment chains (`case_document_comments`).
- **Audit IP address backfill.** Add a request-scoped Nest interceptor that reads `req.ip` and stamps it on every audit row written during the request lifecycle. Removes the silent null in the current implementation.

## 10. Security layers applied

- **Layer 1 — Auth.** Class-level `JwtAuthGuard` on the controller. Frontend layout pre-gates the `/lia/*` portal.
- **Layer 2 — Role gate.** `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')` on the controller. Backend authoritative. The student-side `/students/me/*` namespace explicitly excludes any path to `CaseDocumentReview` rows.
- **Layer 3 — Env vars.** No new env vars. Encryption uses existing `ENCRYPTION_KEY` / `ENCRYPTION_KEY_VERSION`. Signed URLs use existing `JWT_SECRET`.
- **Layer 4 — HTTPS.** Production enforced by Vercel + Railway.
- **Layer 5 — Rate limiting.** Inherits the global 60/min throttler. No per-endpoint throttle; LIA workflow is low volume.
- **Layer 6 — Audit log.** Every mutation + every download writes an `AuditLog` row inside the same `$transaction` (downloads write before returning the URL, so a network failure between issue and use still leaves the audit trail). Snapshot columns (`actorNameSnapshot`, `actorRoleSnapshot`) populated at write time per PR-CONSULT-4.
- **Layer 7 — File uploads.** N/A — this PR does not accept uploads. Downloads use the existing signed-URL pattern (5-minute TTL, JWT-signed payload).
- **Layer 8 — Auto-logout.** Handled by existing session-expiry middleware.
- **Layer 9 — npm audit.** No new dependencies.
- **Layer 10 — DB backups.** One new table; existing nightly Postgres backup covers it.

**Cross-case attack defence.** The `resolveSourceRow` helper is the central choke point. Every download-URL and review endpoint goes through it. Anyone passing a `sourceRowId` that doesn't belong to the requested `caseId` gets a `404 NOT_FOUND` — same error shape as a non-existent row, so an attacker can't differentiate "doesn't exist" from "exists on another case". The check is one extra DB roundtrip per request — acceptable.

**Encryption.** `reasonEncrypted` is `Bytes` carrying the AES-256-GCM envelope from `CryptoService` — same as `LegalNote.bodyEncrypted` (PR-LIA-1). Decryption happens server-side inside the service; the wire response is plaintext. The list endpoint catches decryption failures and returns an empty string rather than throwing, defending against a key rotation that wipes old rows' readability without taking the page down.

## 11. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git log --oneline -5            # confirm the top two are the PR-LIA-5 commits
git revert HEAD~1..HEAD

# 2. drop the new table + enums
psql -d sorenavisaplatform <<SQL
DROP TABLE IF EXISTS "case_document_reviews";
DROP TYPE  IF EXISTS "CaseDocumentReviewStatus";
DROP TYPE  IF EXISTS "CaseDocumentReviewSource";

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260526200000_pr_lia_5_case_document_reviews';
SQL

# 3. push the revert
git push origin main
```

**Verification after rollback:**

```bash
cd backend && npx tsc --noEmit          # clean
cd frontend && npx tsc --noEmit         # clean
curl -i http://localhost:3001/cases/<id>/documents -H "Authorization: Bearer <jwt>"
#   → 404 (route gone)
```

A rollback strips the documents card and the review table; the source upload models (`AdmissionDocument`, `ApplicationDocument`, `VisaSupportingDocument`) are untouched throughout — no client-uploaded data is at risk. The BackLink component and its applications are reverted with the same commit. The `/student/case/messages` back-link target reverts from `/student` to `/student/case` (the previous value).
