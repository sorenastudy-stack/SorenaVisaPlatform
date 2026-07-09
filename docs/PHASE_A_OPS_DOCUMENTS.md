# Phase A — OPS Documents Review Feature (Handover)

**Shipped in commit `f6f41fa`** — *feat(ops): admission-document review queue + page with source-based access control*

This document is self-contained: a developer joining in six months should be able to understand, test, extend, and roll back this feature from this doc alone.

---

## 1. What this feature does

Operations staff (the "Admission Specialists" — role `OPERATIONS`) now have a place to review the admission documents clients upload. A cross-case **queue** (`/ops/documents`) lists every uploaded ADMISSION/APPLICATION document, across all active cases, that no one has approved or rejected yet — oldest first. Clicking **Review** opens a **per-case review page** (`/ops/documents/[caseId]`) where they approve or reject each document with a required reason, and download the file to check it. Crucially, **visa documents (`VISA_SUPPORTING`) remain the LIA team's job** and are invisible and un-actionable to OPS — enforced server-side. LIA and admin-tier users keep their existing full document-review surface at `/lia/cases/[id]` (all three document sources), unchanged in capability.

---

## 2. Files created or changed (10)

| File | Change | Purpose |
|---|---|---|
| `backend/src/case-documents/case-documents.service.ts` | modified | Core logic. Adds `listUnreviewedAcrossCases()` (the OPS queue), `OpsUnreviewedDocumentRow` type, and the **`assertCanAccessSource()`** gate; wires the gate into `upsertReview`, `clearReview`, `createDownloadUrl`; adds a role filter to `listAllDocumentsForCase`. |
| `backend/src/case-documents/ops-documents.controller.ts` | **new** | Exposes `GET /ops/documents/unreviewed` (OPERATIONS + admin tier). Thin controller → `service.listUnreviewedAcrossCases()`. |
| `backend/src/case-documents/case-documents.controller.ts` | modified | Adds `OPERATIONS` to the class `@Roles(...)`; **renames** the list route `GET :caseId/documents` → `GET :caseId/document-reviews`; passes the caller's JWT role into `listAllDocumentsForCase`. |
| `backend/src/case-documents/case-documents.module.ts` | modified | Registers `OpsDocumentsController`. |
| `backend/src/app.module.ts` | modified | Updated the stale "route-collision / shadow" comment above `DocumentsModule` / `CaseDocumentsModule` (documentation only — see §7). |
| `frontend/src/app/ops/documents/page.tsx` | modified | The OPS **queue** page (client component): fetches `/ops/documents/unreviewed`, renders Client / Case / Document / Type / Uploaded / **Review**. Review button → `/ops/documents/[caseId]?client=…`. Loading + empty states. |
| `frontend/src/app/ops/documents/[caseId]/page.tsx` | **new** | The OPS **per-case review** page (server component so `router.refresh()` re-fetches after a verdict). Fetches `/cases/:id/document-reviews`, filters to ADMISSION/APPLICATION, renders rows with the shared Review/Download buttons. Role-gated (OPERATIONS + admin). |
| `frontend/src/components/cases/review/ReviewDocumentButton.tsx` | **relocated** (from `app/lia/cases/[id]/`) | Approve/Reject modal + required reason (10–2000 chars). POSTs `/cases/:id/documents/:source/:sourceRowId/review`, DELETEs to clear. Now shared by LIA + OPS. |
| `frontend/src/components/cases/review/DownloadDocumentButton.tsx` | **relocated** (from `app/lia/cases/[id]/`) | Fetches a signed download URL and opens it. Now shared by LIA + OPS. |
| `frontend/src/app/lia/cases/[id]/page.tsx` | modified | Import paths updated to `@/components/cases/review/*`; the document-list fetch updated `/cases/:id/documents` → **`/cases/:id/document-reviews`** (the renamed route). |

No schema/prisma files changed.

---

## 3. Database tables / columns

**None were added or changed. No migration.** This feature is read-plus-verdict only, on existing models.

### The two document systems (essential context)

The codebase has **two parallel document systems**, both historically mounted under `@Controller('cases')`:

- **System A — raw file storage** (`backend/src/documents/*`, model **`Document`**, table `documents`). R2 / local-disk-backed attachments uploaded via the client/staff Documents panel. Owns `GET /cases/:caseId/documents`. **This feature does not touch System A.**
- **System B — review overlay** (`backend/src/case-documents/*`). It does **not** store files. It provides a unified *read view* over three pre-existing source tables and stores *review verdicts*. **This feature lives entirely in System B.**

### Models this feature reads

| Model | Table | Role here |
|---|---|---|
| `AdmissionDocument` | `admission_documents` | Source `ADMISSION`. Real files on local disk (`fileUrl` is a disk path); uploaded via the student admission flow. |
| `ApplicationDocument` | `application_documents` | Source `APPLICATION`. Read only when `fileUrl` is set. |
| `VisaSupportingDocument` (+ `VisaSupportingDocumentFile`) | `visa_supporting_documents` | Source `VISA_SUPPORTING`. **Excluded** from everything OPS sees. |
| `Case`, `AdmissionApplication`, `Application`, `VisaApplication` | — | Join/filter: active cases (`stage NOT IN (COMPLETED, WITHDRAWN)`), client name, case→source-doc chains. |
| **`CaseDocumentReview`** | `case_document_reviews` | The verdict store. A row exists **only** when a doc is `APPROVED`/`REJECTED` (unique on `(source, sourceRowId)`); "unreviewed" = no row. This feature reads it (queue = docs with no row) and writes it (approve/reject via `upsertReview`). |

Key modeling fact the queue relies on: **"unreviewed" is the *absence* of a `CaseDocumentReview` row.** The queue is a set-difference — all file-backed source docs on active cases, minus the `(source, sourceRowId)` keys that already have a review row.

---

## 4. Environment variables

**None added.** Uses only the existing JWT secret (session/token verification) and the existing signed-URL secret used by the `/files/signed/:token` route.

---

## 5. Third-party services

**None new.** No new SDKs, APIs, webhooks, or infrastructure. Admission files are served from local disk via the existing signed-token route (not R2/S3 for this source).

---

## 6. How to test it works

Prerequisites: backend + frontend running (`pm2 start ecosystem.config.js` from repo root, or `npm run dev:up`). You need an `OPERATIONS` (or OWNER/ADMIN/SUPER_ADMIN) login, and at least one active case with an uploaded admission document that has no verdict yet.

**OPS queue**
1. Log in as an OPS/admin user → go to **`/ops/documents`**.
2. Expect a table of unreviewed admission docs (oldest first): **Client | Case (link) | Document | Type (Admission/Application) | Uploaded (relative time) | Review**. If nothing is pending: the calm empty state *"You're all caught up — no documents waiting for review."*
3. Confirm **no `VISA_SUPPORTING` rows appear** — the queue is admission-sources only.

**OPS review page**
4. Click **Review** on a row → lands on **`/ops/documents/[caseId]`**.
5. Expect the case's admission documents with **Download** and **Review** (Approve/Reject + reason) actions. Only ADMISSION/APPLICATION rows show; visa never appears.
6. **Download** opens the file in a new tab (requires a real file on disk — see §7). **Approve/Reject** with a ≥10-char reason → the row's status updates (the page re-fetches).

**Boundary checks (what should be blocked)** — as an OPS user hitting the API directly:
- `POST /cases/:id/documents/VISA_SUPPORTING/:rowId/review` → **403**
- `GET  /cases/:id/documents/VISA_SUPPORTING/:rowId/download-url` → **403**
- `GET  /cases/:id/document-reviews` → visa rows **filtered out** of the response.

**LIA regression check (this is the route-rename risk)**
7. Log in as an `LIA` user → open **`/lia/cases/[id]`** for a case with documents.
8. Expect the documents table to still list **all three sources including `VISA_SUPPORTING`**, with working Approve/Reject. (This confirms the `GET :caseId/documents` → `:caseId/document-reviews` rename was updated on the LIA caller too — see §7/§10.)

*Verified at ship time:* OPS queue `200` admission-only; OPS approve admission `201`; OPS visa review/download `403`; OPS list excludes visa; LIA list returns all three incl. visa; LIA visa review `201`; OWNER any-source review `201`; download of a **real** admission file returns `200` with the file bytes.

---

## 7. Known limitations (honest list)

- **OPS queue is ADMISSION + APPLICATION only, by design.** `VISA_SUPPORTING` is intentionally excluded from `listUnreviewedAcrossCases()` (it's LIA's scope).
- **The APPLICATION source path is untested with real data.** The test DB has no `EducationProvider` / `EducationProgramme` catalog rows, and an `Application` requires those FKs — so no `ApplicationDocument` could be created for end-to-end testing. The APPLICATION code path is **identical** to ADMISSION (same push logic, different source table), so it's expected to work, but it has not been exercised against real rows. First real application upload should be spot-checked.
- **Latent route collision (now resolved).** Historically both System A (`DocumentsController`) and System B (`CaseDocumentsController`) declared `GET :caseId/documents`. `DocumentsModule` is imported first, so System A won and **System B's list was silently shadowed** — the LIA page's document list was effectively reading System A. This feature renamed System B's list to `:caseId/document-reviews`, which both removes the collision **and** repairs that latent bug. If you ever re-introduce a `:caseId/documents` GET on System B, the shadowing returns.
- **Download depends on a real file existing on disk.** Admission docs are served by `/files/signed/:token` → `res.sendFile(fileUrl)`. If a row's `fileUrl` points at a missing file (e.g. a DB-seeded row with no real upload), the mint returns `200` but fetching the signed URL returns **404 "File not found."** This is expected — it's not a bug in the download path.
- **No per-document deep-link.** The queue links to the case's review page, not to a specific document anchor.
- **No pagination / filters** on the queue yet (see §8).

---

## 8. How a future developer extends this

- **The source-access rule lives in one place:** `assertCanAccessSource(role, source)` in `case-documents.service.ts`. Change who can touch which source there — it's called by `upsertReview`, `clearReview`, and `createDownloadUrl`, and mirrored by the role filter in `listAllDocumentsForCase`. Keep those in sync.
- **Add a source to the OPS queue:** edit `listUnreviewedAcrossCases()` — add a block that reads the new source table (mirror the ADMISSION/APPLICATION blocks: fetch file-backed rows on active cases, skip ones already in the `reviewed` set, `push(...)`).
- **Add filters/sorting/pagination:** the queue endpoint returns a plain array; add query params to `OpsDocumentsController.unreviewed()` and thread them into the service, or filter client-side in `ops/documents/page.tsx`.
- **Add a Compliance view (the sibling OPS stub):** follow this feature's shape — a new controller route under an OPS-gated path, a service method that reads existing models, and a client page under `/ops/*` (which the `/ops` layout already role-gates). Reuse `components/cases/review/*` if it involves document verdicts.
- **Give another role admission-review rights:** add it to the controller `@Roles(...)` **and** decide its source rule in `assertCanAccessSource` — the guard admits, the service restricts.

---

## 9. Security layers applied

Mapped to the project's 10 security rules:

- **#2 Access control (primary):** two enforcement points, both server-side.
  - *Role gate:* `CaseDocumentsController` and `OpsDocumentsController` use `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OPERATIONS','LIA','ADMIN','SUPER_ADMIN','OWNER')` (OPS controller: `OPERATIONS + admin tier`).
  - *Source gate:* `assertCanAccessSource()` in `case-documents.service.ts` is the boundary that keeps OPS out of visa docs. It's called **before** any DB lookup in `upsertReview`, `clearReview`, `createDownloadUrl`, and reflected in `listAllDocumentsForCase`'s filter. The role comes from the **verified JWT** (`req.user.role`, populated by `JwtAuthGuard`) via the controller's `actor(req)` — never from request body/query. A crafted OPS request for a visa doc is rejected `403` even if the row exists and belongs to the case.

    ```ts
    // case-documents.service.ts — the whole rule, server-side, JWT-sourced role:
    private assertCanAccessSource(
      role: string | null | undefined,
      source: CaseDocumentReviewSource,
    ) {
      if (role === 'OPERATIONS' && source === 'VISA_SUPPORTING') {
        throw new ForbiddenException(
          'Operations may only access admission documents (ADMISSION / APPLICATION).',
        );
      }
    }
    ```
- **#1 Authentication:** every route sits behind `JwtAuthGuard`; the actor id/role are taken from the verified token.
- **#7 File upload / storage:** downloads never expose a raw path or a public URL — `createDownloadUrl` mints a short-lived (5-min) signed token (`createSignedDownloadToken`), and the file is served only through `/files/signed/:token`. OPS is additionally blocked from minting a visa-doc token (#2).
- **#6 Audit:** review verdicts and downloads continue to write `AuditLog` rows (`LIA_DOCUMENT_REVIEWED`, `LIA_DOCUMENT_DOWNLOADED`) via the existing service paths — now attributed to OPS actors too.
- **#8 Least privilege:** the frontend OPS pages also filter to ADMISSION/APPLICATION (belt-and-suspenders), but the authoritative boundary is server-side. UI hiding is never the security control.
- **Not applicable / unchanged:** #3 secrets, #4 HTTPS, #5 rate limiting, #9/#10 — no changes here. No money-path code was touched.

---

## 10. Rollback instructions

To undo the feature safely:

```bash
git revert f6f41fa      # creates an inverse commit; preferred (keeps history)
# or, if not yet built on:  git reset --hard f6f41fa^   (destructive; only if HEAD is still f6f41fa)
```

`git revert f6f41fa` restores everything atomically, including the two points that **must move together** or the LIA page breaks:

1. **The route rename** — backend `case-documents.controller.ts` (`:caseId/document-reviews` → `:caseId/documents`) **and** the frontend caller `frontend/src/app/lia/cases/[id]/page.tsx` (`/cases/:id/document-reviews` → `/cases/:id/documents`) revert **as one commit**. Never revert one without the other: if the backend route name and the LIA fetch URL disagree, the LIA documents list 404s. (After reverting, System B's list is once again shadowed by System A — the pre-existing latent state; acceptable, since that's how it was.)
2. **The button relocation** — `components/cases/review/*` moves back to `app/lia/cases/[id]/*` and the LIA imports revert together.

No database or migration rollback is needed (nothing was added). After reverting, restart the backend so the route mapping reloads (`pm2 restart sorena-backend`). The OPS `/ops/documents` pages revert to their prior "Coming soon" stub state.
