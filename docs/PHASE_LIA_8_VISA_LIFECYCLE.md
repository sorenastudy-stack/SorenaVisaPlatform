# PR-LIA-8 — Visa lifecycle (approval + decline)

PR-LIA-7 captured the moment the LIA submits an application to Immigration NZ. PR-LIA-8 closes the loop: when INZ decides, the LIA records the outcome, the case completes, and the client gets an outcome-appropriate email. Two symmetric paths: APPROVED (visa file + start/end dates) and DECLINED (confidential reason + neutral client email). The "more info requested" workflow is explicitly deferred to PR-LIA-8.1.

Mirror, where applicable, of the PR-LIA-7 INZ submission shape — same controller/service/DTO layout, same multipart upload pipeline, same file-on-disk + denormalised metadata strategy. The new datum lives on its own model (`Visa`) rather than denormalised on `Case` (see §3).

---

## 1. Scope

In:

* New `Visa` model — 1:0..1 with `Case`, populated when the LIA records the INZ outcome
* New `VisaIssueOutcome` enum — `APPROVED` | `DECLINED`
* Backend service + controller with 5 endpoints:
  * `POST /cases/:id/visa/issue` — multipart, APPROVED + visa file + start/end dates
  * `POST /cases/:id/visa/decline` — JSON, DECLINED + confidential reason
  * `PATCH /cases/:id/visa` — JSON, text-only metadata edit
  * `POST /cases/:id/visa/revert` — JSON, destructive un-issue back to INZ_SUBMITTED
  * `GET /cases/:id/visa/document-url` — 5-minute signed URL for the visa document
* Two new client-facing emails on `NotificationsService` (best-effort, never blocks)
* Five new audit event types
* Five new client components on the case-detail page + an outcome-aware header badge
* Visa-issued / visa-declined banners on the inz-data viewer page
* "Completed" chip on the cases queue page

Out (deferred):

* "More info requested" workflow (PR-LIA-8.1)
* Visa expiry reminders + automated emails (PR-LIA-9)
* Visa renewal flow (PR-LIA-9)
* Multi-entry / single-entry tracking
* Visa amendments (post-issuance corrections from INZ)
* Manual visa-email resend endpoint
* Bulk visa issuance
* Client-portal visa download view (the email + signed link is the primary delivery for now)

---

## 2. State machine

```
ADMISSION
   │  (existing PR-LIA flow)
   ▼
   VISA  ─── PR-LIA-7 submit ───►  INZ_SUBMITTED
                                       │
                                       ├── PR-LIA-8 issue   ──►  COMPLETED  (Visa.outcome = APPROVED)
                                       │
                                       └── PR-LIA-8 decline ──►  COMPLETED  (Visa.outcome = DECLINED)

                            ◄── PR-LIA-8 revert (un-issue) ──┘
```

Revert is a single endpoint that handles both outcomes: it deletes the `Visa` row and sets `Case.stage = INZ_SUBMITTED`. The visa document file stays on disk under `./uploads/visas/<caseId>/` for forensic recovery — orphan cleanup is a future concern (same pattern as PR-LIA-7).

---

## 3. Data model — why a separate `Visa` table, not denormalised on `Case`

PR-LIA-7 denormalised the INZ submission onto `Case` (7 columns, one-receipt-per-case lifecycle bound tightly to the submission stage). For PR-LIA-8 we picked the opposite: a dedicated `Visa` table.

Why:

* **Two distinct outcome shapes.** Approval needs dates + file metadata; decline needs an encrypted reason. Denormalising would have meant ~9 nullable columns on `Case`, where 4-5 are always NULL depending on the outcome.
* **Forward compatibility with PR-LIA-9.** Expiry reminders need to query "approved visas expiring in N days" — a table with `@@index([visaEndDate])` makes that a one-line query. Doing the same against `cases.visaEndDate` would mean either a partial index or scanning all completed rows.
* **Outcome-specific audit trail.** Revert clears one row instead of nulling out a column block, which makes "find cases that have ever been issued" much cleaner than the equivalent on `Case` would have been.
* **Cleaner cascade semantics.** `onDelete: Cascade` on `caseId` means deleting a case tears down its visa row exactly like it tears down LegalNotes and CaseMessages. The pattern matches.

Schema lives in `backend/prisma/schema.prisma` (search for `model Visa`). The migration is `20260527000000_pr_lia_8_visa_lifecycle/migration.sql`.

### Columns

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `caseId` | text UNIQUE | FK → `cases.id` ON DELETE CASCADE |
| `outcome` | `VisaIssueOutcome` | `APPROVED` | `DECLINED` |
| `visaStartDate` | timestamp | populated when APPROVED |
| `visaEndDate` | timestamp | populated when APPROVED |
| `visaDocumentUrl` | text | filesystem path under `./uploads/visas/<caseId>/` |
| `visaDocumentName` | text | original filename for human-readable downloads |
| `visaDocumentMime` | text | |
| `visaDocumentSize` | int | bytes |
| `declineReasonEncrypted` | bytea | populated when DECLINED; AES-256-GCM via `CryptoService` |
| `issuedById` | text | FK → `users.id` (NO ACTION) |
| `issuedAt` | timestamp | default now() |
| `notes` | text | optional |
| `createdAt` / `updatedAt` | timestamp | |

### Indexes

* `UNIQUE(caseId)` — 1:0..1 invariant; the schema enforces it
* `(issuedById, issuedAt)` — productivity report can later aggregate decisions per LIA
* `(visaEndDate)` — **forward hook for PR-LIA-9** expiry-reminder queries

---

## 4. Backend — files added / modified

### New (4)

* [backend/src/cases/visa/visa.service.ts](../backend/src/cases/visa/visa.service.ts) — 5 methods: `issueApprovedVisa`, `recordDeclinedVisa`, `editVisaRecord`, `revertVisaRecord`, `getVisaDocumentInfo`, plus `getDeclineReasonForCase` helper for the cases.service boundary decrypt
* [backend/src/cases/visa/visa.controller.ts](../backend/src/cases/visa/visa.controller.ts) — 5 routes, class-level `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')`, multer config inline
* [backend/src/cases/visa/dto/visa.dto.ts](../backend/src/cases/visa/dto/visa.dto.ts) — `IssueVisaDto`, `DeclineVisaDto`, `EditVisaDto`, `RevertVisaDto`
* [backend/prisma/migrations/20260527000000_pr_lia_8_visa_lifecycle/migration.sql](../backend/prisma/migrations/20260527000000_pr_lia_8_visa_lifecycle/migration.sql)

### Modified (5)

* [backend/prisma/schema.prisma](../backend/prisma/schema.prisma) — `enum VisaIssueOutcome`, `model Visa`, `visa Visa?` on `Case`, `issuedVisas Visa[]` on `User`
* [backend/src/cases/cases.module.ts](../backend/src/cases/cases.module.ts) — register `VisaService` + `VisaController`
* [backend/src/cases/cases.service.ts](../backend/src/cases/cases.service.ts) — include `visa: true` on `findOne`; decrypt `declineReasonEncrypted` at the boundary; strip ciphertext before returning
* [backend/src/notifications/notifications.service.ts](../backend/src/notifications/notifications.service.ts) — `sendVisaIssuedToClient`, `sendVisaDeclinedToClient`
* [backend/src/common/audit/audit.helper.ts](../backend/src/common/audit/audit.helper.ts) — 5 new event-type cases
* [backend/src/inz-data/inz-data.service.ts](../backend/src/inz-data/inz-data.service.ts) — surface `visaOutcome` / `visaEndDate` / `visaIssuedAt` on the inz-data response for the issued/declined banners

---

## 5. Frontend — files added / modified

### New (5)

* [frontend/src/app/lia/cases/[id]/RecordVisaApprovalButton.tsx](../frontend/src/app/lia/cases/[id]/RecordVisaApprovalButton.tsx) — multipart overlay; visa file + start/end dates + notes
* [frontend/src/app/lia/cases/[id]/RecordVisaDeclineButton.tsx](../frontend/src/app/lia/cases/[id]/RecordVisaDeclineButton.tsx) — red-accented modal; required confidential reason
* [frontend/src/app/lia/cases/[id]/EditVisaRecordButton.tsx](../frontend/src/app/lia/cases/[id]/EditVisaRecordButton.tsx) — outcome-aware editor (dates vs decline reason)
* [frontend/src/app/lia/cases/[id]/RevertVisaRecordButton.tsx](../frontend/src/app/lia/cases/[id]/RevertVisaRecordButton.tsx) — two-step destructive (reason + type case ID)
* [frontend/src/app/lia/cases/[id]/DownloadVisaButton.tsx](../frontend/src/app/lia/cases/[id]/DownloadVisaButton.tsx) — fetch signed URL → open in new tab

### Modified (4)

* [frontend/src/app/lia/cases/[id]/page.tsx](../frontend/src/app/lia/cases/[id]/page.tsx) — extended `CaseDetail.visa`, outcome-aware header badge, new `<VisaOutcomePanel />`
* [frontend/src/app/lia/cases/[id]/inz-data/page.tsx](../frontend/src/app/lia/cases/[id]/inz-data/page.tsx) — issued / declined banners
* [frontend/src/app/lia/cases/page.tsx](../frontend/src/app/lia/cases/page.tsx) — Stage filter "Completed" chip
* [frontend/src/app/lia/_utils/format.ts](../frontend/src/app/lia/_utils/format.ts) — `completedOutcomeLabel`, `completedOutcomeStyles`, `visaExpiryStyles`, `visaExpiryLabel`

---

## 6. Routes (new)

| Verb | Path | Auth | Notes |
|---|---|---|---|
| POST | `/cases/:id/visa/issue` | LIA/ADMIN/SUPER_ADMIN/OWNER | multipart; `file` + `visaStartDate` + `visaEndDate` + `notes?` |
| POST | `/cases/:id/visa/decline` | LIA/ADMIN/SUPER_ADMIN/OWNER | JSON; `declineReason` (10–5000) + `notes?` |
| PATCH | `/cases/:id/visa` | LIA/ADMIN/SUPER_ADMIN/OWNER | JSON; text-only edit |
| POST | `/cases/:id/visa/revert` | LIA/ADMIN/SUPER_ADMIN/OWNER | JSON; `reason` (10–500) |
| GET | `/cases/:id/visa/document-url` | LIA/ADMIN/SUPER_ADMIN/OWNER | returns `{ url, expiresInSeconds: 300 }` |

All five return `401` unauthenticated and `403` to any role outside the gate set.

---

## 7. Audit events (new)

* `VISA_ISSUED` — `newValue: { caseId, visaId, visaStartDate, visaEndDate, fileName, fileSize }`
* `VISA_DECLINED` — `newValue: { caseId, visaId, declineReasonHash, declineReasonLength }` (sha256 hash of the plaintext, never the plaintext itself)
* `VISA_RECORD_EDITED` — `newValue` carries the field names that changed
* `VISA_RECORD_REVERTED` — `oldValue.outcome` carries the previous outcome; `newValue.reasonEncryptedBase64` carries the revert reason
* `VISA_DOCUMENT_DOWNLOADED` — `newValue: { visaId, fileName }`

All five are surfaced through `summarizeAuditEntry` in [audit.helper.ts](../backend/src/common/audit/audit.helper.ts).

---

## 8. Confidentiality of the decline reason

The decline reason is the most sensitive datum in this PR. Handling:

* **At rest:** `Visa.declineReasonEncrypted` (bytea, AES-256-GCM via `CryptoService`, same envelope as every other PII column).
* **In transit (server → client):** decrypted at the cases.service boundary on `findOne` and surfaced as `case.visa.declineReason`; the encrypted Buffer is stripped from the response.
* **In audit:** only a sha256 hash of the plaintext + the byte length. The plaintext never lands in `audit_logs`.
* **In email:** the client-facing decline email never includes the reason. Body says "your application was not approved by Immigration NZ, your case advisor will be in touch" with a link to `/student/case`.
* **In UI:** the decline reason renders only inside the case-detail Visa Record panel (LIA-only surface).

---

## 9. Constraints honoured

* No new npm dependencies
* No new env vars
* `req.user?.userId ?? req.user?.id` — preserves the d95640d JWT actor-id fix
* No audit-log skips — every mutation writes one
* Email is best-effort, wrapped in `try { … }.catch(log)` after the transaction commits
* No client-visible decline reason
* No regression on PR-LIA-7 INZ flow

---

## 10. Backlog

* **PR-LIA-8.1** — "More info requested" workflow. Adds a third outcome (`MORE_INFO_REQUESTED`) that keeps the case in `INZ_SUBMITTED` while capturing what INZ asked for. Likely needs a child table to enumerate the requested items + a re-submit endpoint.
* **PR-LIA-9** — visa expiry reminders. Reads `visas` filtered by `visaEndDate` between now and the threshold; emails the client + LIA. Renewal flow likely also lives here.
* **Receipt re-upload during edit** — currently the visa file is read-only post-issuance; the LIA must revert + re-issue to swap it. A future tweak could allow file re-upload via the PATCH endpoint.
* **Cleanup job for revert-orphaned visa files** — orphan files under `./uploads/visas/<caseId>/` after a revert. The same audit-log replay pattern that PR-LIA-7 will eventually use applies here.
* **Client-portal visa download** — currently the only path to the visa document is through the LIA. A future student-dashboard view could offer a signed download to the client directly.
* **Email attachments / templated emails** — the current sendVisaIssuedToClient links to the dashboard, but doesn't attach the visa PDF directly. Once email templates are extracted, attach support can come too.
* **Productivity report — outcomes column** — the LIA productivity report (PR-LIA-3) can now grow an "outcomes recorded" column by aggregating `visas` rows on `(issuedById, issuedAt)`.
* **Server-side `daysRemaining` derived field** — frontend computes this from `visaEndDate - now`; a server-side projection could make the value consistent across timezones.
