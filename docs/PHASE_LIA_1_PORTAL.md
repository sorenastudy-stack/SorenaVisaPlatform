# PR-LIA-1 — LIA Portal (frontend + legal-notes backend)

The first live surface for the LIA (Legal & Immigration Adviser) team. Replaces the placeholder `/lia` pages with a complete review-and-action portal, and adds a small backend module — `LegalNote` — that backs the four LIA actions: add note, record decision, override risk, clear hard stop.

## 1. What this PR does

Adds a complete LIA portal at `/lia/*` (dashboard, cases queue, case detail, decisions log, documents view) and the minimal backend surface needed to actually take action from those screens. Until this PR, the LIA team could only read leads via the CRM-side `/cases` endpoint — there was no way for an LIA to record an opinion or override risk without touching the database directly.

Two new endpoints carry the LIA's authoritative actions: `PATCH /cases/:id/risk` (LIA overrides the case + lead risk level with a written justification) and `PATCH /cases/:id/clear-hard-stop` (LIA clears a Lead's hard-stop flag and re-enables execution). Both pair the underlying state change with a `LegalNote` row that captures the LIA's reason, plus an `AuditLog` entry with the PR-CONSULT-4 snapshot columns so attribution survives even after a User row is hard-deleted.

A second pair of endpoints — `POST /cases/:caseId/legal-notes` and `POST /cases/:caseId/decision` — let the LIA add free-form notes or record formal decisions (APPROVED / REJECTED / NEEDS_MORE_INFO / WITHDRAWN). Both shape variants share the same `legal_notes` table; the row is a note when `decision IS NULL` and a decision when `decision IS NOT NULL`. Recording a WITHDRAWN decision also moves the Case's `stage` to `WITHDRAWN` in the same transaction.

Frontend follows the PR-CONSULT-2 / PR-WIX-1 conventions: server components do all data fetching via `@/lib/apiServer`; client overlay components handle mutations via `@/lib/api`, `router.refresh()` on success, inline error rendering, no `alert()`, no `localStorage`. Filters are URL-driven (shareable, back-button works). Encryption uses the existing `CryptoService` envelope.

## 2. Files changed

Backend (new):
- `prisma/migrations/20260526000000_pr_lia_1_legal_notes/migration.sql` — creates the `LegalDecision` enum + `legal_notes` table + composite index.
- `src/legal-notes/legal-notes.module.ts` — wires `PrismaModule` + `CryptoModule`.
- `src/legal-notes/legal-notes.controller.ts` — mounted at `/cases/:caseId/legal-notes` and `/cases/:caseId/decision`. Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN')`.
- `src/legal-notes/legal-notes.service.ts` — `listForCase` / `createNote` / `recordDecision`. Each mutation runs in a transaction that writes the `LegalNote` row + a paired `AuditLog` entry.
- `src/legal-notes/dto/legal-notes.dto.ts` — `CreateLegalNoteDto`, `RecordDecisionDto`, `LegalDecisionDto` enum.
- `src/cases/dto/lia-actions.dto.ts` — `OverrideRiskDto`, `ClearHardStopDto` (both require a 10–5000 char `reason`).

Backend (existing):
- `prisma/schema.prisma` — new `LegalDecision` enum; new `LegalNote` model; inverse `legalNotes` relation on both `Case` and `User`.
- `src/cases/cases.controller.ts` — adds `PATCH /cases/:id/risk` and `PATCH /cases/:id/clear-hard-stop`. Both guarded per-route with `@UseGuards(RolesGuard)` + `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN')` so they're LIA-only without touching the access on the existing `GET`/`PATCH /cases/:id` routes.
- `src/cases/cases.service.ts` — adds `overrideRisk` + `clearHardStop` service methods. Each runs in a transaction: state change (Case.riskLevel + Lead.riskLevel for risk; Lead.hardStopFlag/Reason/executionAllowed for hard-stop), `LegalNote` row with the encrypted reason, `AuditLog` row with snapshot columns.
- `src/cases/cases.module.ts` — imports `CryptoModule` (the service now encrypts the legal-note body).
- `src/app.module.ts` — registers `LegalNotesModule`.
- `src/common/audit/audit.helper.ts` — adds four new `summarizeAuditEntry` cases: `LEGAL_NOTE_ADDED`, `LEGAL_DECISION_RECORDED`, `LIA_RISK_OVERRIDDEN`, `LIA_HARD_STOP_CLEARED`.

Frontend (new):
- `src/app/lia/_utils/format.ts` — pure helpers: `riskStyles`, `stageStyles`, `decisionStyles`, `docStatusStyles`, `formatDate`, `formatDateTime`, `formatRelative`, plus labels and the `isEscalatedRisk` predicate (HIGH ∪ BLOCKED).
- `src/app/lia/cases/[id]/page.tsx` — case detail server component. Header + flags banner + Action Panel + three-column intelligence grid + Applications + Contract + Legal Notes timeline.
- `src/app/lia/cases/[id]/ClearHardStopButton.tsx` — overlay client component.
- `src/app/lia/cases/[id]/OverrideRiskButton.tsx` — overlay client component.
- `src/app/lia/cases/[id]/AddLegalNoteButton.tsx` — overlay client component.
- `src/app/lia/cases/[id]/RecordDecisionButton.tsx` — overlay client component.

Frontend (existing):
- `src/app/lia/page.tsx` — dashboard. Live stat cards from `GET /cases`, recent escalations list, status breakdown, quick links.
- `src/app/lia/cases/page.tsx` — escalated cases queue with URL-driven risk + stage filter chips and a responsive table.
- `src/app/lia/decisions/page.tsx` — decisions log. Aggregates `LegalNote` rows across visible cases where `decision IS NOT NULL`. URL-driven outcome filter.
- `src/app/lia/documents/page.tsx` — documents view across escalated cases. URL-driven status + risk filter. **Never renders a clickable file URL** — the only action is "Open case".

No new npm dependencies. No new env vars. One Prisma migration.

## 3. Schema added

```prisma
enum LegalDecision {
  APPROVED
  REJECTED
  NEEDS_MORE_INFO
  WITHDRAWN
}

model LegalNote {
  id                       String         @id @default(uuid())
  caseId                   String
  authorId                 String
  bodyEncrypted            Bytes
  decision                 LegalDecision?
  decisionReasonEncrypted  Bytes?
  createdAt                DateTime       @default(now())

  case   Case @relation(fields: [caseId], references: [id], onDelete: Cascade)
  author User @relation("LegalNoteAuthor", fields: [authorId], references: [id])

  @@index([caseId, createdAt])
  @@map("legal_notes")
}
```

One table backs both row variants. `decision IS NULL` ⇒ free-form note; `decision IS NOT NULL` ⇒ formal decision (with reason). Both encrypted columns use the existing AES-256-GCM envelope from `CryptoService` (1-byte version + 12-byte IV + 16-byte tag + ciphertext).

Hand-written migration `backend/prisma/migrations/20260526000000_pr_lia_1_legal_notes/migration.sql`. FKs: `caseId` ON DELETE CASCADE (a deleted Case wipes its legal trail); `authorId` ON DELETE NO ACTION (legal authorship survives a User hard-delete; PR-CONSULT-4's audit-log snapshot columns handle attribution post-deletion).

Two new fields on the existing `Case` and `User` models — just inverse `legalNotes` relations, no new columns.

## 4. Endpoint contract

| Method | Path | Role gate | Purpose |
|---|---|---|---|
| GET | `/cases/:caseId/legal-notes` | LIA / ADMIN / SUPER_ADMIN | List notes + decisions for a case, decrypted, ordered ASC by `createdAt`. |
| POST | `/cases/:caseId/legal-notes` | LIA / ADMIN / SUPER_ADMIN | `{ body: string (10–5000) }`. Creates a note (decision = null). |
| POST | `/cases/:caseId/decision` | LIA / ADMIN / SUPER_ADMIN | `{ decision, reason: string (10–5000) }`. Creates a formal decision; if `decision === 'WITHDRAWN'`, also flips `Case.stage` to `WITHDRAWN`. |
| PATCH | `/cases/:id/risk` | LIA / ADMIN / SUPER_ADMIN | `{ riskLevel, reason: string (10–5000) }`. Updates `Case.riskLevel` AND `Lead.riskLevel` in one transaction. Writes a paired `LegalNote` + `AuditLog`. |
| PATCH | `/cases/:id/clear-hard-stop` | LIA / ADMIN / SUPER_ADMIN | `{ reason: string (10–5000) }`. Sets `Lead.hardStopFlag=false`, `Lead.hardStopReason=null`, `Lead.executionAllowed=true`. Writes a paired `LegalNote` + `AuditLog`. |

**Response shapes:**

`GET /cases/:caseId/legal-notes`:

```json
[
  {
    "id": "uuid",
    "caseId": "cuid",
    "authorId": "cuid",
    "authorName": "Aria Karimi",
    "body": "Considered the academic record — strong fit for the visa stage.",
    "decision": null,
    "decisionReason": null,
    "createdAt": "2026-05-26T03:12:00.000Z"
  },
  {
    "id": "uuid",
    "caseId": "cuid",
    "authorId": "cuid",
    "authorName": "Aria Karimi",
    "body": "Decision recorded: APPROVED",
    "decision": "APPROVED",
    "decisionReason": "All documents present, no risk flags.",
    "createdAt": "2026-05-26T03:30:00.000Z"
  }
]
```

`PATCH /cases/:id/risk` returns the updated `Case` row. `PATCH /cases/:id/clear-hard-stop` returns `{ id, leadId, hardStopFlag: false, executionAllowed: true }`.

Mutation contract: every legal action writes **two rows** — a `LegalNote` (encrypted reason / body, surfaced in the case-detail timeline) and an `AuditLog` (structured JSON, surfaced via `summarizeAuditEntry` in the activity feed). The dual write lives in a single Prisma `$transaction`; if either fails, neither lands.

## 5. Decision lifecycle

Two row variants in one table:

| Variant | `decision` | `bodyEncrypted` | `decisionReasonEncrypted` |
|---|---|---|---|
| Note | `NULL` | LIA's free-form note | `NULL` |
| Decision | `'APPROVED' \| 'REJECTED' \| 'NEEDS_MORE_INFO' \| 'WITHDRAWN'` | Auto-generated summary line (`"Decision recorded: APPROVED"`) | LIA's written justification |

Recording a `WITHDRAWN` decision triggers a side effect: `Case.stage` is set to `WITHDRAWN` in the same transaction. The other three decision outcomes do not change `Case.stage` — a rejected applicant might still need to be left in their current stage for downstream cleanup. The Case-stage move is the only automatic side effect; everything else stays the LIA's manual call.

The frontend Decisions log (`/lia/decisions`) aggregates rows where `decision IS NOT NULL` across every case the LIA can see, sorted newest-first. Free-form notes (decision = NULL) appear only in the per-case timeline, not in the global Decisions log.

## 6. LIA action matrix

The case-detail Action Panel exposes four buttons. The table below shows what each writes:

| Button | Endpoint | Updates | Writes |
|---|---|---|---|
| Clear hard stop | `PATCH /cases/:id/clear-hard-stop` | `Lead.hardStopFlag=false`, `Lead.hardStopReason=null`, `Lead.executionAllowed=true` | `LegalNote` (note variant, body = previous reason + LIA's justification) + `AuditLog(LIA_HARD_STOP_CLEARED)` |
| Override risk | `PATCH /cases/:id/risk` | `Case.riskLevel = new`, `Lead.riskLevel = new` | `LegalNote` (note variant, body = "Risk overridden from X to Y…") + `AuditLog(LIA_RISK_OVERRIDDEN)` |
| Add legal note | `POST /cases/:caseId/legal-notes` | — | `LegalNote` (note variant, body = LIA's free text) + `AuditLog(LEGAL_NOTE_ADDED)` |
| Record decision | `POST /cases/:caseId/decision` | If WITHDRAWN: `Case.stage='WITHDRAWN'` | `LegalNote` (decision variant) + `AuditLog(LEGAL_DECISION_RECORDED)` |

The "Clear hard stop" button is disabled when `Lead.hardStopFlag === false` — there's nothing to clear. Frontend disables it; backend doesn't currently re-check (idempotent: clearing an already-cleared lead is a no-op besides another audit row).

## 7. How to test (manual)

1. **Type-check clean:** `cd backend && npx tsc --noEmit` exits clean. `cd frontend && npx tsc --noEmit` exits clean.
2. **Migration applied:** `npx prisma migrate status` shows `20260526000000_pr_lia_1_legal_notes` applied.
3. **Schema columns exist:** `\d legal_notes` shows the seven columns + the `legal_notes_caseId_createdAt_idx` index.
4. **Login as a user with `role = LIA`.** Sidebar shows the LIA Portal nav (Dashboard / Cases / Document Review / Decisions).
5. **Visit `/lia`.** Stat cards render with live counts (Needs Review / Blocked / High Risk / Active Cases). Recent escalations list is populated or shows the "All caught up" empty state.
6. **Visit `/lia/cases`.** Filter chips work: Risk → Escalated, then Risk → Blocked. The URL updates with `?risk=...`; results re-filter client-side. Stage chips filter via the backend `?stage=...` param.
7. **Open a case detail.** The flags banner appears red when the lead has `hardStopFlag=true` or `riskFlags.length > 0`. The Action Panel renders four buttons; "Clear hard stop" is disabled if there's nothing to clear.
8. **Add a legal note.** Click "Add legal note", type < 10 chars — the Save button stays disabled. Type a longer note and save. The overlay closes; the timeline below the page refreshes (via `router.refresh()`) and shows the new entry attributed to your name.
9. **Override risk.** Click "Override risk", choose a different level, type a justification, save. The header risk badge updates on refresh, and a new legal-note timeline entry shows the override reason. Inspect the DB: `SELECT "riskLevel" FROM cases WHERE id = '<id>'` should match; `SELECT "riskLevel" FROM leads WHERE id = '<leadId>'` should match.
10. **Clear hard stop.** From a case where `Lead.hardStopFlag = true`, click "Clear hard stop", type a justification, save. The flags banner disappears on refresh. `SELECT "hardStopFlag", "executionAllowed", "hardStopReason" FROM leads WHERE id = '<leadId>'` returns `(false, true, NULL)`.
11. **Record a decision.** Click "Record decision", choose `APPROVED`, type a reason, save. The decision appears in the timeline as an emerald-tinted card. Repeat with `WITHDRAWN` on a different case; confirm the case-detail header stage badge flips to `Withdrawn` after refresh.
12. **Decisions log.** Visit `/lia/decisions`. Both decisions appear; clicking the Approved filter chip narrows to one. URL updates to `?filter=APPROVED`.
13. **Documents view.** Visit `/lia/documents`. Documents from escalated cases only are listed. Confirm the only action button is "Open case" — there is no raw file URL anywhere on the page.
14. **Access control.** Log out and back in as a `SALES` user. Visiting `/lia` redirects to `/unauthorized`. Hitting the backend `POST /cases/<id>/legal-notes` with a SALES JWT returns 403.
15. **Audit log:**
    ```sql
    SELECT id, "eventType", "actorNameSnapshot", "newValue", "createdAt"
      FROM audit_logs
     WHERE "eventType" IN ('LEGAL_NOTE_ADDED','LEGAL_DECISION_RECORDED','LIA_RISK_OVERRIDDEN','LIA_HARD_STOP_CLEARED')
     ORDER BY "createdAt" DESC LIMIT 10;
    ```
    Expect one row per mutation, with the actor name + role populated.

## 8. Known limitations

- **No staff-picker UI for re-assigning a case.** The LIA can override risk and clear hard stops but can't hand the case off to a specific consultant from the Action Panel. Re-assignment still lives on the staff users / cases pages.
- **Decisions log fans out one HTTP call per case.** `/lia/decisions` calls `GET /cases` then `GET /cases/:id/legal-notes` for every visible case. Works fine at the current scale (a few hundred cases) but should be replaced with a single aggregate endpoint (`GET /legal-notes?caseIds=...` or `GET /legal-notes/decisions`) once the visible-cases count crosses a few hundred. Same fan-out shape on `/lia/documents`.
- **No client-side search on the cases queue.** Risk + stage filter chips only; no free-text search box. The PR-SUPPORT-1 search pattern (in-memory match on prefetched rows) is the obvious model for a future PR.
- **`Application` and `ApplicationDocument` are read-only here.** No "approve document" / "reject document" UI for the LIA — that lives in the consultant-side pages. The Documents view here is purely a triage list.
- **No bulk decision recording.** Each decision is one click + one justification. Adequate for the LIA's low-volume workflow; revisit if approvals start landing in batches of 20+.
- **`AuditLog` entries are not paged into the case-detail page.** The timeline shows `LegalNote` rows only; the broader activity feed (with staff assignments, meeting events, etc.) is not rendered here. PR-CONSULT-2 already ships an activity feed on the staff case-detail page — surfacing the same feed in the LIA case-detail is a near-zero-cost future PR.
- **No undo / soft-delete on `LegalNote`.** A wrong note stays in the timeline; the LIA can post a follow-up note correcting it. By design — the LIA's record is meant to be append-only for compliance.
- **No file attachments on legal notes.** The PR-SEC3 metadata-only file pattern is the obvious model when this becomes a need.
- **Lead deletion does not cascade `LegalNote`.** Cascade is via `caseId`. If a `Lead` is hard-deleted without its `Case` first, the `LegalNote` rows survive and the FK to the now-orphaned Case becomes invalid only when the Case row itself is removed. In practice Leads are never hard-deleted; the PR-CONSULT-4 hard-delete path is for `User` rows, not `Lead`/`Case`.

## 9. How to extend

- **Add an aggregate decisions endpoint.** Replace the N+1 fan-out on `/lia/decisions` with `GET /legal-notes?decisionsOnly=true&limit=...`. Service does one query against `legal_notes` joined to `cases.lead.contact` for the name. Drop-in replacement for the page's data-fetch block.
- **Add a SUPPORT-readable case view.** Today the "View case" link from a support ticket lands on `/lia/cases/<id>`, which only works for LIA / ADMIN / SUPER_ADMIN. Build a sibling read-only `/staff/cases/<id>` that any staff role can see, surfaces the same `LegalNote` timeline read-only, and removes the Action Panel.
- **Add bulk re-assignment.** Extend `/lia/cases` with row checkboxes + a sticky bulk-action bar. New endpoint `POST /cases/bulk-reassign` accepting `{ caseIds, ownerId }`.
- **Add file attachments on legal notes.** Extend `LegalNote` with an `attachments LegalNoteFile[]`. Reuse the PR-SEC3 metadata-only file pattern; decrypt + signed-URL through the existing `GET /files/:id/signed-url` route.
- **Add document approve / reject from the LIA Documents view.** Today action is "Open case" only. New endpoints on `ApplicationsController` would let the LIA flip a document's status inline; pair with an audit row + a paired `LegalNote` that captures the reason.
- **Add a re-open mechanism for WITHDRAWN cases.** Today `Case.stage = WITHDRAWN` is a one-way flip via `RecordDecisionButton`. A new `PATCH /cases/:id/reopen` with `{ reason }` could pair with a `LegalNote` and audit row to push `stage` back to `ADMISSION`.
- **Add LegalDecision = ESCALATED.** When the LIA wants to bump a case to OWNER review without giving a final outcome, an `ESCALATED` decision (paired with the existing `OwnerApprovalRequest` machinery from PR-CONSULT-1) would replace the implicit "leave it as HIGH risk and add a note" workflow.

## 10. Security layers applied

- **Layer 1 — Auth.** `frontend/src/app/lia/layout.tsx` calls `getSession()` and redirects to `/login?next=/lia` if absent. Every backend endpoint added here uses `JwtAuthGuard`.
- **Layer 2 — Role gate.** Backend: `@Roles('LIA', 'ADMIN', 'SUPER_ADMIN')` + `RolesGuard` on the `LegalNotesController` (class-level) and on each new route in `CasesController` (per-route to avoid affecting the existing routes). Frontend layout re-checks the same set and redirects to `/unauthorized` if mismatched. Two-layer defence — frontend gate is UX, backend gate is authoritative.
- **Layer 3 — Env vars.** No new env vars. Encryption (`ENCRYPTION_KEY`, `ENCRYPTION_KEY_VERSION`) and DB URL are already in place. The boot check in `CryptoService` ensures a misconfigured backend fails closed.
- **Layer 4 — HTTPS.** Production is enforced by the Vercel + Railway deploys; no code.
- **Layer 5 — Rate limiting.** No new throttle; the global 60/min default still applies. The LIA endpoints are staff-only and low volume — a tight per-endpoint throttle would cost more in misfires than it saves.
- **Layer 6 — Audit log.** Every mutation runs in a transaction that writes both a `LegalNote` row (encrypted body, surfaced in the case-detail timeline) and an `AuditLog` row (structured `oldValue` / `newValue` JSON, surfaced via `summarizeAuditEntry`). Snapshot columns (`actorNameSnapshot` / `actorRoleSnapshot`) are populated at write time per the PR-CONSULT-4 pattern.
- **Layer 7 — File uploads.** N/A — no file uploads in this PR. The LIA Documents view deliberately surfaces no clickable file URLs.
- **Layer 8 — Auto-logout.** Handled by the existing session-expiry middleware; no change.
- **Layer 9 — npm audit.** No new dependencies. Baseline unchanged.
- **Layer 10 — DB backups.** One new table, no new sensitive plaintext columns (the two writeable text fields land as `Bytes` after `CryptoService.encrypt`). The existing nightly Postgres backup picks it up automatically.

**Documents-view security note.** `/lia/documents` deliberately renders neither file URLs nor document IDs as clickable downloads. The only action button on every row is "Open case", which links to `/lia/cases/<caseId>`. The LIA reviews documents in the context of the case, not by direct URL access — keeps audit attribution clean (every read happens through the case page, never via a guessable file URL).

**Encryption note.** `bodyEncrypted` and `decisionReasonEncrypted` use the existing `CryptoService.encrypt` envelope (AES-256-GCM, base64 envelope, key version prefix). Decryption happens server-side inside the service; the wire response is plaintext. The pattern matches every other encrypted-PII column in the project (`VisaCaseFileNote.summaryEncrypted`, `VisaSupportTicket.subjectEncrypted`, etc.).

## 11. Rollback procedure

```bash
# 1. revert the two commits (feature + handover)
git log --oneline -5            # confirm the top two are the PR-LIA-1 commits
git revert HEAD~1..HEAD

# 2. drop the new table + enum
psql -d sorenavisaplatform <<SQL
DROP TABLE IF EXISTS "legal_notes";
DROP TYPE  IF EXISTS "LegalDecision";

DELETE FROM _prisma_migrations
  WHERE migration_name = '20260526000000_pr_lia_1_legal_notes';
SQL

# 3. push the revert
git push origin main
```

**Verification after rollback:**

```bash
cd backend && npx tsc --noEmit          # clean
cd frontend && npx tsc --noEmit         # clean
curl -i http://localhost:3001/cases/<id>/legal-notes -H "Authorization: Bearer <jwt>"
#   → 404 (route gone)
```

A rollback drops the LIA's action surface but leaves audit attribution intact — every action taken before the rollback retains its `AuditLog` row, just without the paired `LegalNote` body decryptable on the frontend (the rows still exist in DB but no route reads them). If the rollback is being applied because of a wider issue, the DB backup taken the night before the migration (the standard nightly routine) is the cleaner restore path.
