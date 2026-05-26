# PR-LIA-4 — Direct LIA ↔ client messaging (with document requests)

The case-thread surface. The LIA can message their client and request specific documents; the client can reply and link an already-uploaded `VisaSupportingDocument` to fulfil each request. One model, one service, two role-gated controllers, two new UI surfaces. All bodies encrypted at rest. Every mutation audited.

## 1. What this PR does

Adds a direct conversation channel between the LIA and the client on a CRM `Case`. Until this PR, every LIA→client interaction was either out-of-band (email/WhatsApp) or routed through the student support tickets system (`VisaSupportTicket`, PR-DASH-2), which was built for "client asks for help" — not "LIA needs a thing from the client". PR-LIA-4 fills the missing direction.

Three row variants share one `CaseMessage` table, discriminated by `kind`:

- `MESSAGE` — free-form text, either direction.
- `DOCUMENT_REQUEST` — LIA → client. Carries `requestedDocType` (a string like `PASSPORT_COPY`). Becomes "fulfilled" when the client links an existing `VisaSupportingDocument` via the dedicated fulfil endpoint.
- `PROGRESS_UPDATE` — LIA → client. Full-width navy-tinted banner on both sides; used for status broadcasts ("Submitted to INZ", "Got your offer letter").

Read-tracking is per-thread per-viewer (`readByLia`, `readByClient`), not per-message. When the LIA fetches the thread, every unread CLIENT-authored row flips to `readByLia=true` in one update and a single `CASE_MESSAGE_READ` audit row records the count. Same on the client side with the directions reversed.

No new env vars. No new npm dependencies. One Prisma migration. No real-time layer — refresh-based only, matching the existing portal pattern.

## 2. Files changed

Backend (new):
- `prisma/migrations/20260526120000_pr_lia_4_case_messages/migration.sql` — creates the two new enums + `case_messages` table + three indexes + three FKs.
- `src/case-messages/case-messages.module.ts` — wires `PrismaModule` + `CryptoModule`.
- `src/case-messages/case-messages.controller.ts` — LIA-side. Mounted at `/cases`, class-level `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')`. Four routes (list, post, request-document, mark-read).
- `src/case-messages/case-messages.student.controller.ts` — student-side. Mounted at `/students/me/case-messages`, class-level `@Roles('STUDENT')`. Five routes (list, unread-count, post, fulfil, mark-read).
- `src/case-messages/case-messages.service.ts` — one service backs both controllers. Owns the encryption + audit-pair writes + viewer-aware mark-read + the Case → VisaCase resolution for the companion `VisaCaseFileNote`.
- `src/case-messages/dto/case-messages.dto.ts` — `CreateMessageDto`, `RequestDocumentDto`, `FulfilRequestDto`, `LiaMessageKindDto` enum.

Backend (existing):
- `prisma/schema.prisma` — new enums (`CaseMessageAuthorRole`, `CaseMessageKind`); new `CaseMessage` model; inverse `caseMessages` relations on `Case`, `User` (`"CaseMessageAuthor"`), `VisaSupportingDocument` (`"CaseMessageFulfilment"`).
- `src/app.module.ts` — registers `CaseMessagesModule`.
- `src/common/audit/audit.helper.ts` — four new `summarizeAuditEntry` cases: `CASE_MESSAGE_POSTED`, `CASE_DOCUMENT_REQUESTED`, `CASE_DOCUMENT_FULFILLED`, `CASE_MESSAGE_READ`.

Frontend (new):
- `src/app/lia/cases/[id]/SendMessageButton.tsx` — overlay client component. POSTs to `/cases/:id/messages`. Optional "progress update" checkbox.
- `src/app/lia/cases/[id]/RequestDocumentButton.tsx` — overlay client component with a `COMMON_DOC_TYPES` dropdown + `OTHER` fallback to a free-text input.
- `src/app/student/case/messages/page.tsx` — server component. Thread + composer.
- `src/app/student/case/messages/ReplyComposer.tsx` — client component. POSTs to `/students/me/case-messages`.
- `src/app/student/case/messages/FulfilRequestButton.tsx` — client component. Fetches the student's existing `VisaSupportingDocument` rows via the existing `GET /students/me/visa/supporting-documents` route and lets them link one. No new file-upload flow.

Frontend (existing):
- `src/app/lia/cases/[id]/page.tsx` — fetches the case thread and renders the new "Messages to client" card between Contract and Legal notes. Adds the `CaseMessage` type and the local `MessageBubble` helper.
- `src/app/student/layout.tsx` — fetches the unread count and passes it through.
- `src/components/portal/PortalLayout.tsx` — adds the `studentUnreadMessages` prop and a red-dot badge on the matching nav item. Repoints the student "Messages" nav entry from `/student/messages` to `/student/case/messages`.

Frontend (removed):
- `src/app/student/messages/page.tsx` — the old "Coming soon" placeholder. The page that replaces it lives at `/student/case/messages`; the nav entry was repointed accordingly.

No new npm dependencies, no new env vars.

## 3. Schema added

```prisma
enum CaseMessageAuthorRole {
  LIA
  CLIENT
}

enum CaseMessageKind {
  MESSAGE
  DOCUMENT_REQUEST
  PROGRESS_UPDATE
}

model CaseMessage {
  id                String                  @id @default(uuid())
  caseId            String
  authorId          String
  authorRole        CaseMessageAuthorRole
  kind              CaseMessageKind         @default(MESSAGE)
  bodyEncrypted     Bytes
  requestedDocType  String?
  fulfilledByFileId String?
  fulfilledAt       DateTime?
  readByClient      Boolean                 @default(false)
  readByLia         Boolean                 @default(false)
  createdAt         DateTime                @default(now())

  case            Case                    @relation(fields: [caseId], references: [id], onDelete: Cascade)
  author          User                    @relation("CaseMessageAuthor", fields: [authorId], references: [id])
  fulfilledByFile VisaSupportingDocument? @relation("CaseMessageFulfilment", fields: [fulfilledByFileId], references: [id], onDelete: SetNull)

  @@index([caseId, createdAt])
  @@index([caseId, readByClient])
  @@index([caseId, readByLia])
  @@map("case_messages")
}
```

Three index choices, three FK behaviours:

- `(caseId, createdAt)` — the timeline query (`ORDER BY createdAt ASC` scoped to one case).
- `(caseId, readByClient)` and `(caseId, readByLia)` — used by the unread-count query for the student dashboard badge and by the mark-thread-read `updateMany` in the service.
- `caseId` ON DELETE CASCADE — case removal wipes the thread.
- `authorId` ON DELETE NO ACTION — authorship survives a User hard-delete; the PR-CONSULT-4 audit-log snapshot pattern handles attribution post-deletion.
- `fulfilledByFileId` ON DELETE SET NULL — if the supporting document is removed, the message keeps its history but the link goes null.

**Note on the FK target.** The original PR-LIA-4 spec referenced a `VisaCaseFile` model that doesn't exist in the schema. The natural FK targets for "the file the client linked" are either `ApplicationDocument` (CRM-side, admission docs, has `fileUrl`) or `VisaSupportingDocument` (visa-side, metadata only). This PR picks `VisaSupportingDocument` because the visa-stage is where LIA-document-requests are expected to fire, and the existing `GET /students/me/visa/supporting-documents` route already returns the list of files the client can link. If admission-side fulfilment is needed later, the FK can be relaxed (replaced with a polymorphic ID or a second optional FK column).

## 4. Endpoint contract

### LIA-side — `/cases/:caseId/messages/*`

All four routes guarded `JwtAuthGuard + RolesGuard`, `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')`.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/cases/:caseId/messages` | — | List the full thread, oldest-first, decrypted. Side effect: flips all unread CLIENT rows to `readByLia=true` and emits one `CASE_MESSAGE_READ` audit row. |
| POST | `/cases/:caseId/messages` | `{ body: string (10–5000), kind?: 'MESSAGE' \| 'PROGRESS_UPDATE' }` | LIA posts a message. Default `kind` is `MESSAGE`; `PROGRESS_UPDATE` is the full-width banner. |
| POST | `/cases/:caseId/messages/document-request` | `{ body: string (10–5000), requestedDocType: string (1–100) }` | LIA opens a DOCUMENT_REQUEST. |
| PATCH | `/cases/:caseId/messages/mark-read` | — | Explicit mark-read trigger. GET already does this automatically; useful for "the LIA has seen this thread without re-loading the full list" flows. |

### Client-side — `/students/me/case-messages/*`

All five routes guarded `JwtAuthGuard + RolesGuard`, `@Roles('STUDENT')`. **The student never passes a `caseId`** — it's resolved server-side from `session.userId` via Contact → Lead → Case.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/students/me/case-messages` | — | List the thread for the student's own case. Same mark-read side effect, flipped direction. |
| GET | `/students/me/case-messages/unread-count` | — | Returns `{ count: number }`. Used by the sidebar badge. Doesn't change any state. |
| POST | `/students/me/case-messages` | `{ body: string (10–5000) }` | Client reply (always `kind=MESSAGE`, `authorRole=CLIENT`). |
| POST | `/students/me/case-messages/:messageId/fulfil` | `{ fileId: string }` | Link a `VisaSupportingDocument` to a DOCUMENT_REQUEST. Validates the message belongs to the student's case AND the file belongs to the student's visa application. Idempotency: returns 400 if already fulfilled. |
| PATCH | `/students/me/case-messages/mark-read` | — | Explicit mark-read trigger from the client side. |

### Sample responses

`GET /cases/:caseId/messages` → an array of:

```json
{
  "id": "uuid",
  "caseId": "cuid",
  "authorId": "cuid",
  "authorName": "Aria Karimi",
  "authorRole": "LIA",
  "kind": "DOCUMENT_REQUEST",
  "body": "Please share your latest IELTS result so I can finalise the offer.",
  "requestedDocType": "IELTS_RESULT",
  "fulfilledByFileId": null,
  "fulfilledByFileName": null,
  "fulfilledAt": null,
  "readByClient": false,
  "readByLia": true,
  "createdAt": "2026-05-26T03:12:00.000Z"
}
```

`GET /students/me/case-messages/unread-count`:

```json
{ "count": 3 }
```

## 5. Audit contract

Each mutation runs inside a single `prisma.$transaction` that writes **one** `AuditLog` row, and — when the case has reached the visa phase and a `VisaCase` resolves through Case → AdmissionApplication → VisaApplication → VisaCase — **one** companion `VisaCaseFileNote` row with `summaryEncrypted`. The `VisaCaseFileNote.noteType` is:

- `TICKET` for DOCUMENT_REQUEST creation and DOCUMENT_REQUEST fulfilment (keeps the case-file feed coherent with the existing student support ticket pattern).
- `SYSTEM_EVENT` for plain messages and progress updates.

For pre-visa cases (where the VisaCase doesn't exist yet) the `AuditLog` is the canonical record; the `VisaCaseFileNote` write is silently skipped. The actor name + role are snapshot on the audit row at write time per the PR-CONSULT-4 pattern.

| Event type | Trigger | `newValue` shape |
|---|---|---|
| `CASE_MESSAGE_POSTED` | POST `/cases/:caseId/messages` OR POST `/students/me/case-messages` | `{ messageId, authorRole, kind, bodyLength }` |
| `CASE_DOCUMENT_REQUESTED` | POST `/cases/:caseId/messages/document-request` | `{ messageId, authorRole, kind: 'DOCUMENT_REQUEST', requestedDocType, bodyLength }` |
| `CASE_DOCUMENT_FULFILLED` | POST `/students/me/case-messages/:messageId/fulfil` | `{ messageId, fileId, documentType }` |
| `CASE_MESSAGE_READ` | Any read that flips one or more rows from unread to read | `{ caseId, count, viewer }` (`viewer` is `'LIA'` or `'CLIENT'`) |

The `CASE_MESSAGE_READ` row is emitted **only** when at least one message actually changed state. A reload that finds no unread messages emits no audit row.

## 6. Read-tracking semantics

Two `Boolean` columns per row: `readByLia` and `readByClient`. They are independent — the LIA marking the thread read does not change `readByClient`.

On insert:

- Author sees their own message as already read (`readByLia=true` for an LIA-authored row, `readByClient=true` for a CLIENT-authored row).
- The other side starts unread.

On a viewer-side fetch (`listForCaseAsLia` / `listForCaseAsClient`):

```sql
UPDATE case_messages
   SET readByLia = true              -- or readByClient = true
 WHERE caseId = $1
   AND readByLia = false             -- or readByClient = false
   AND authorRole = 'CLIENT';        -- or 'LIA' on the client side
```

One round-trip. The `updateMany.count` is recorded in the single audit row.

A DOCUMENT_REQUEST fulfilment also marks `readByClient=true` on the fulfilled row even if it was already unread — the client just acted on the thread, treating that as a read is appropriate.

There is no per-message read receipt. The pattern is deliberately coarse: "the LIA has seen this thread", not "the LIA has seen message #4". If finer granularity becomes a need, a `read_at` timestamp per row is the obvious extension.

## 7. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` and `cd frontend && npx tsc --noEmit` both exit clean.
2. **Migration applied:** `npx prisma migrate status` shows `20260526120000_pr_lia_4_case_messages` applied. `\d case_messages` lists the 11 columns + three indexes.
3. **Login as a user with `role = LIA`** (or OWNER/ADMIN/SUPER_ADMIN). Visit `/lia/cases/<id>` of a case whose lead's contact is linked to a User with `role = STUDENT`.
4. **The "Messages to client" card** appears between Contract and Legal notes. Empty-state placeholder is visible if there are no messages.
5. **Send a message.** Click "Send message", type ≥ 10 chars, hit Send. The card refreshes with a right-aligned gold bubble attributed to your name.
6. **Send a progress update.** Same flow with the checkbox ticked. The row renders full-width with a navy banner labelled "Progress update".
7. **Request a document.** Click "Request document", pick `IELTS_RESULT`, write a justification, send. An amber bordered DOCUMENT_REQUEST card appears in the thread.
8. **Log out, log in as the matching STUDENT.** Sidebar shows a red dot on "Messages". Open it (`/student/case/messages`).
9. **The thread renders the LIA's messages.** Plain messages are left-aligned white; the progress update is a full-width banner; the document request shows an amber card with an "Upload / link document" button.
10. **Reply.** Type ≥ 10 chars, send. The new bubble appears right-aligned gold attributed to "You".
11. **Fulfil the request.** Click "Upload / link document". The overlay lists your `VisaSupportingDocument` rows (or shows an empty-state with a deep link to `/student/documents` if you have none). Pick one. The request flips to "Fulfilled" with the filename shown.
12. **Back to the LIA.** Refresh `/lia/cases/<id>`. The reply appears; the document request shows a green "Fulfilled" badge and the linked filename.
13. **Audit log:**
    ```sql
    SELECT id, "eventType", "actorNameSnapshot", "newValue", "createdAt"
      FROM audit_logs
     WHERE "eventType" IN ('CASE_MESSAGE_POSTED','CASE_DOCUMENT_REQUESTED','CASE_DOCUMENT_FULFILLED','CASE_MESSAGE_READ')
     ORDER BY "createdAt" DESC LIMIT 15;
    ```
    Expect one row per mutation, plus the read-flip rows from each side's fetch.
14. **Access control.** As a `SALES` user, hitting `POST /cases/<id>/messages` returns 403. As a `STUDENT`, hitting `POST /cases/<id>/messages` (without the `/students/me` prefix) returns 403.

## 8. Known limitations

- **No email / push / Slack notification on new message.** The other side only sees it after their next page load. Deferred to PR-LIA-9 (notifications).
- **No real-time updates.** No websocket / SSE layer; refresh-based per the spec. A future PR can wire Pusher (already in use for the chatbot) per `case.id`.
- **No per-message read receipts.** Read-tracking is per-thread per-viewer (one Boolean per side). "The LIA has read message #4" requires a separate `read_at` timestamp column.
- **No bulk actions.** Each message and each fulfilment is one click. Adequate for the per-case workflow.
- **One requested doc type per request.** If the LIA needs three documents, that's three DOCUMENT_REQUEST rows. By design — keeps the fulfilment state simple (one FK per row).
- **No edit / delete.** Messages are append-only. Misspoke? Post a follow-up. The audit log captures the original.
- **No client-side file upload from the messages page.** The client can only link an existing `VisaSupportingDocument`. If their target file isn't there, the UI redirects them to `/student/documents`. This avoids duplicating the existing upload flow and its file-validation logic.
- **`fulfilledByFile` FK is to `VisaSupportingDocument` only.** Admission-side documents (`ApplicationDocument`) can't be linked yet — the column is a single FK. Future-PR extension would relax this to a polymorphic ID or a second optional FK.
- **VisaCaseFileNote is best-effort.** Pre-visa cases don't get a companion file note (no VisaCase to attach it to). The AuditLog is the canonical record in that scenario. Once the case crosses into the visa phase, every subsequent mutation does get the paired file note.
- **No cross-case messaging surface for the LIA.** No "inbox" of all unread case threads — the LIA has to open each case individually. PR-LIA-10 territory.
- **Mark-read endpoint is shared but split between two controllers.** PATCH `/cases/:caseId/messages/mark-read` (LIA) and PATCH `/students/me/case-messages/mark-read` (student). The service has a shared `markRead` method that takes a viewer-role argument; the two routes pass the appropriate value. If a future role joins the conversation (a SUPPORT triage view, say), a third route would be needed.
- **Encryption boundary is the `body` string only.** `requestedDocType` is plaintext (it's a type code like `PASSPORT_COPY`, not PII). The fulfilled file's filename is plaintext on `VisaSupportingDocument.originalFilename` per the existing convention. If filenames are deemed PII, a separate encryption pass on that column is the fix — out of scope here.

## 9. How to extend

- **Add email / push notification.** Inject `NotificationsService` into `CaseMessagesService.insertMessage` and fire an out-of-band call after the transaction commits. Match the existing chatbot escalation pattern.
- **Add real-time updates.** Wire Pusher (already a dependency) on every insert. Frontend subscribes per `case.id`; `router.refresh()` on receipt. Same shape as the PR-DASH-4 chatbot.
- **Add per-message read receipts.** Drop the two Booleans, add a `CaseMessageRead` join table `(messageId, viewerId, readAt)`. Adjust the fetch + mark-read flow to insert one row per (message, viewer). Costs one extra row per message per viewer; only worth it if the LIA + client both want "they've seen message #4".
- **Add multi-doc requests.** Extend `CaseMessage` with `requestedDocTypes: String[]` and `fulfilledByFileIds: String[]`. Or — much simpler — keep one doc per message and add a "Request these together" UI affordance that creates N messages with the same opening body.
- **Add `ApplicationDocument` fulfilment.** Drop the typed FK; replace with `fulfilledByFileId: String` (no FK) + `fulfilledByFileSource: 'VISA' | 'ADMISSION'` enum. Service resolves at read time. The frontend `FulfilRequestButton` lists both `VisaSupportingDocument` and `ApplicationDocument` rows.
- **Add an LIA inbox.** New endpoint `GET /lia/messages/unread` joining `case_messages` against the LIA's assigned cases. New page at `/lia/messages` showing the cross-case thread digest.
- **Add file attachments to plain messages** (not just to fulfilment). New `attachments` relation on `CaseMessage` to a thin metadata-only file model. Reuse the existing signed-URL pattern from PR-SEC3.

## 10. Security layers applied

- **Layer 1 — Auth.** Both controllers use `JwtAuthGuard`. The frontend `/lia` and `/student` layouts both check `getSession()` and redirect to `/login` if absent. Middleware (`frontend/src/middleware.ts`) gates the path-prefixes at the edge.
- **Layer 2 — Role gate.** LIA controller: `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN', 'OWNER')`. Student controller: `@Roles('STUDENT')`. Two-layer defence — frontend layout re-checks; backend is authoritative.
- **Layer 3 — Env vars.** No new env vars. Encryption (`ENCRYPTION_KEY` / `ENCRYPTION_KEY_VERSION`) is already in place. Misconfigured backend fails closed via `CryptoService`'s boot check.
- **Layer 4 — HTTPS.** Production enforced by the Vercel + Railway deploys; no code.
- **Layer 5 — Rate limiting.** Inherits the global 60/min throttler default. No per-endpoint throttle was added — the LIA + student endpoints are low-volume internal surfaces and a tight throttle would cost more in misfires than it saves. If the future PR-LIA-9 (notifications) adds outbound emails per message, a write-side throttle becomes worth considering.
- **Layer 6 — Audit log.** Every mutation writes a paired `AuditLog` row inside the same `$transaction` as the data change. Snapshot columns (`actorNameSnapshot`, `actorRoleSnapshot`) are populated at write time per PR-CONSULT-4. `summarizeAuditEntry` in `audit.helper.ts` was extended with four new cases so the activity feed renders them.
- **Layer 7 — File uploads.** No new upload flow. The fulfilment path links to an already-uploaded `VisaSupportingDocument` row by ID; the bytes never reach this module's code path. The fulfilment endpoint validates the file belongs to the student's visa application (via `Case → AdmissionApplication → VisaApplication`) before accepting the link.
- **Layer 8 — Auto-logout.** Handled by the existing session-expiry middleware; no change.
- **Layer 9 — npm audit.** No new dependencies. Baseline unchanged.
- **Layer 10 — DB backups.** One new table + one new enum. The encrypted columns are `Bytes`, never plaintext; the existing nightly Postgres backup picks them up automatically.

**Encryption note.** `bodyEncrypted` uses the existing `CryptoService.encrypt` envelope (AES-256-GCM, 1-byte version prefix + 12-byte IV + 16-byte tag + ciphertext). Decryption happens server-side inside the service; the wire response is plaintext.

**Authorisation note.** The student endpoints **never trust a `caseId` from the request body**. The case is resolved server-side from `req.user.userId` via Contact → Lead → Case. A malicious client cannot read or post into another student's thread by passing a foreign `caseId`. The fulfilment endpoint additionally validates the `fileId` belongs to the student's visa application — a malicious client cannot link someone else's file.

## 11. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git log --oneline -5            # confirm the top two are the PR-LIA-4 commits
git revert HEAD~1..HEAD

# 2. drop the new table + enums
psql -d sorenavisaplatform <<SQL
DROP TABLE IF EXISTS "case_messages";
DROP TYPE  IF EXISTS "CaseMessageKind";
DROP TYPE  IF EXISTS "CaseMessageAuthorRole";

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260526120000_pr_lia_4_case_messages';
SQL

# 3. push the revert
git push origin main
```

**Verification after rollback:**

```bash
cd backend && npx tsc --noEmit          # clean
cd frontend && npx tsc --noEmit         # clean
curl -i http://localhost:3001/cases/<id>/messages -H "Authorization: Bearer <jwt>"
#   → 404 (route gone)
```

A rollback drops the messaging surface but leaves the existing tickets / meetings / chatbot paths untouched. The student's sidebar "Messages" nav item still points at `/student/case/messages`, which would 404 post-rollback — the rollback's `git revert` reverses the nav-item edit as well, so the placeholder route returns. The DB cleanup is unconditional (cascade drops both enums); there's no data to migrate back.
