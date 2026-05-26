# PR-LIA-12 — Case File Note

Final PR in the LIA roadmap. Where the rest of the LIA series introduced *data* (notes, decisions, messages, documents, INZ submissions, visa outcomes, expiry reminders, officer profiles, metrics), PR-LIA-12 is the *single chronological view* that aggregates everything into one read-only timeline per case. No schema changes, no new dependencies — just careful aggregation across every PR-LIA model and a per-allocation access gate.

Two endpoints: a JSON timeline for the UI, and an OWNER-only Markdown / Text download for distribution outside the platform. Every view and every export writes an audit row.

---

## 1. Scope

In:

* New backend `CaseFileNoteService` aggregating across 10+ source tables
* New backend `CaseFileNoteController` with 2 endpoints
* Per-case access helper `canAccessCaseFileNote` (pure function, reused by view + export)
* 2 new audit event types (`CASE_FILE_NOTE_VIEWED`, `CASE_FILE_NOTE_EXPORTED`)
* New `/lia/cases/[id]/file-note` page with overview card, counts strip, vertical timeline
* OWNER-only `<ExportFileNoteButtons>` client component (Markdown + plain text)
* "View Case File Note" CTA button on the case detail page

Out (deferred):

* PR-LIA-12.1 — PDF export (needs a PDF library + layout engine)
* PR-LIA-12.2 — Search within timeline
* PR-LIA-12.3 — Per-event filter chips ("show only client messages", "show only decisions")
* PR-LIA-12.4 — Per-LIA temporary export grants
* CSV export (case timelines aren't tabular)
* Streaming for cases with > 5000 events (current in-memory approach is fine for the target scale)
* Real-time updates while viewing — refresh-based for now
* External share (email to INZ officer) — OWNER downloads and distributes manually
* Multi-case bulk export
* Verbose mode showing all audit-log noise — per Decision 3, we surface human-readable events only
* Embedded file previews (PDFs, images inline)
* Client-facing version — explicitly out of scope; the file note is staff-only

---

## 2. Access model — the per-allocation gate

The route's `@Roles()` decorator is the first wall, the per-case `canAccessCaseFileNote` helper is the second. Both must pass.

| Role | View `/cases/:id/file-note` | Download `/cases/:id/file-note/export` |
|---|---|---|
| OWNER | always | **always (only role allowed)** |
| ADMIN | always | **blocked at controller** |
| SUPER_ADMIN | always | **blocked at controller** |
| LIA | only when `case.liaId === user.userId` | blocked at controller |
| CONSULTANT | only when `case.ownerId === user.userId` | blocked at controller |
| anyone else | blocked at controller | blocked at controller |

`canAccessCaseFileNote` lives in [backend/src/cases/case-access.helper.ts](../backend/src/cases/case-access.helper.ts) as a pure function so the view endpoint, the export endpoint, and any future endpoint that needs per-case allocation gating can share the same logic. No DB calls inside — the caller passes the already-loaded `case_` and `user`.

The CONSULTANT-via-`case.ownerId` mapping is documented in the helper. CRM Cases use `ownerId` for staff allocation; PR-CONSULT-1's `VisaCaseAssignment` model is for the dashboard-side workflow, not the CRM case.

---

## 3. The export role gate is **strictly OWNER**

Confirmed on both layers:

* `@Roles('OWNER')` on the export route — ADMIN and SUPER_ADMIN are blocked at the controller, never reach the service
* `canAccessCaseFileNote` still runs inside `exportAsMarkdown` / `exportAsText` via `getTimeline` (defence in depth)
* `<ExportFileNoteButtons>` returns `null` when `userRole !== 'OWNER'` — the UI never renders the buttons for anyone else

This is intentional: the file note is the most concentrated single artifact per case, and lets one file leave the platform with the full chronology. Distribution is OWNER's call.

---

## 4. Data lineage — every source table the aggregation reads

| Source | Events produced |
|---|---|
| `Case` (the row itself) | `CASE_OPENED` synthesized from `createdAt` |
| `AuditLog` (entityType = 'CASE', entityId = caseId) | `LIA_ASSIGNED`, `LIA_REASSIGNED`, `RISK_OVERRIDDEN`, `HARD_STOP_CLEARED`, `INZ_SUBMITTED`, `INZ_SUBMISSION_EDITED`, `INZ_SUBMISSION_REVERTED`, `VISA_ISSUED`, `VISA_DECLINED`, `VISA_RECORD_REVERTED`, `OFFICER_LINKED`, `OFFICER_UNLINKED` |
| `LegalNote` | `LEGAL_NOTE_ADDED` (decision IS NULL) + `DECISION_RECORDED` (decision IS NOT NULL) |
| `CaseMessage` | `CLIENT_MESSAGE` |
| `AdmissionDocument` (via Case → AdmissionApplication) | `DOCUMENT_UPLOADED` source=ADMISSION |
| `VisaSupportingDocument` (via Case → AdmissionApplication → VisaApplication) | `DOCUMENT_UPLOADED` source=VISA_SUPPORTING |
| `CaseDocumentReview` | `DOCUMENT_REVIEWED` |
| `VisaSupportTicket` (via the visa-case resolve chain) | `TICKET_OPENED` |
| `VisaSupportTicketMessage` (CLIENT + STAFF; SYSTEM rows skipped) | `TICKET_MESSAGE` |
| `VisaMeeting` (status = COMPLETED, by VisaCase.clientId) | `MEETING_HELD` |

`STAGE_CHANGED` lives in the type union for forward-compat but is **not** emitted by this PR. The explicit transition events (`INZ_SUBMITTED`, `VISA_ISSUED`, `INZ_SUBMISSION_REVERTED`, `VISA_RECORD_REVERTED`) carry the same information without duplication.

### Encryption handling

Every body field on the source tables is encrypted at rest (`bodyEncrypted`, `decisionReasonEncrypted`, `reasonEncrypted`, `subjectEncrypted`, etc.). The service decrypts each one server-side via `CryptoService` before adding the event to the response — the per-case access gate has already validated the viewer's right to see it. Per-row decryption is wrapped in `tryDecryptBytes`: a failure logs the error and substitutes `[DECRYPTION ERROR]` rather than crashing the whole timeline.

The `VisaMeeting.transcriptNotes` column uses the base64-in-String envelope (rather than `Bytes`), so the meeting branch base64-decodes before calling `crypto.decrypt`; failure returns `null`.

---

## 5. Backend — files added / modified

### New (4)

* [backend/src/cases/case-access.helper.ts](../backend/src/cases/case-access.helper.ts) — pure access predicate
* [backend/src/cases/case-file-note/case-file-note.service.ts](../backend/src/cases/case-file-note/case-file-note.service.ts) — aggregator + Markdown / Text renderers (~700 LOC)
* [backend/src/cases/case-file-note/case-file-note.controller.ts](../backend/src/cases/case-file-note/case-file-note.controller.ts) — 2 routes with split role gates
* `docs/PHASE_LIA_12_CASE_FILE_NOTE.md` (this file)

### Modified (2)

* [backend/src/cases/cases.module.ts](../backend/src/cases/cases.module.ts) — register `CaseFileNoteService` + `CaseFileNoteController`
* [backend/src/common/audit/audit.helper.ts](../backend/src/common/audit/audit.helper.ts) — `CASE_FILE_NOTE_VIEWED` and `CASE_FILE_NOTE_EXPORTED` event types

---

## 6. Frontend — files added / modified

### New (2)

* [frontend/src/app/lia/cases/[id]/file-note/page.tsx](../frontend/src/app/lia/cases/[id]/file-note/page.tsx) — server-rendered timeline page with vertical accent rail + per-event dot color
* [frontend/src/app/lia/cases/[id]/file-note/ExportFileNoteButtons.tsx](../frontend/src/app/lia/cases/[id]/file-note/ExportFileNoteButtons.tsx) — OWNER-only client component (fetch → blob → `<a download>`)

### Modified (1)

* [frontend/src/app/lia/cases/[id]/page.tsx](../frontend/src/app/lia/cases/[id]/page.tsx) — "View Case File Note" CTA next to the existing "View INZ application data" link

---

## 7. Routes

| Verb | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/cases/:caseId/file-note` | LIA/CONSULTANT/ADMIN/SUPER_ADMIN/OWNER (controller) + per-case allocation (service) | Returns JSON timeline; writes `CASE_FILE_NOTE_VIEWED` audit row |
| GET | `/cases/:caseId/file-note/export?format=md\|txt` | **OWNER only** (controller) + per-case allocation (service) | Returns `text/markdown` or `text/plain` with `Content-Disposition: attachment`; writes `CASE_FILE_NOTE_EXPORTED` audit row |

Filename pattern: `case-<caseId>-filenote-<YYYY-MM-DD>.md` / `.txt`. The date is today's UTC date.

Both routes use `req.user?.userId ?? req.user?.id` (d95640d). Cache headers explicitly `no-store` on the export so browsers don't cache the OWNER's download.

---

## 8. Markdown vs plain-text format

Same data, different presentation. The Markdown export uses:

* `# H1` for the page title
* `## H2` for the Overview / Timeline / Summary counts sections
* `- **[YYYY-MM-DD HH:MM]** *Event type* — by *Actor*` for each event head
* `> blockquote` indentation for long body fields (legal notes, message bodies, decline reasons, transcript notes)

The plain-text export uses:

* `=` bars top and bottom
* `-` bars under section headings
* `[YYYY-MM-DD HH:MM] EVENT_TYPE — by ACTOR — detail` for short single-line events
* Two-space indentation for multi-line bodies
* **No** Markdown bold/italic markers anywhere (strict plain text)

Both honour the same chronological order, the same actor-name resolution, the same encrypted-body decryption path. The exporter's name + role appear in the header, the export timestamp appears in both the header and the footer.

---

## 9. Constraints honoured

* **No new npm dependencies.** Verified.
* **No new env vars.** Verified.
* **No schema changes / migrations / maintained counters.** All aggregation is read-time; the existing indexes on each source table cover the case-scoped queries.
* **Per-case access gate.** `canAccessCaseFileNote` runs in `getTimeline`, which is called by both the view route and (transitively) the export routes. Defence in depth.
* **Audit on every access.** Every `getTimeline` call writes `CASE_FILE_NOTE_VIEWED`; every `exportAsMarkdown` / `exportAsText` call additionally writes `CASE_FILE_NOTE_EXPORTED`.
* **Markdown and Text exports share underlying content.** Both go through the same `getTimeline` to build the dataset, then through dedicated renderers.
* **Encrypted bodies are decrypted server-side.** No `[ENCRYPTED]` markers in the output.
* **Export gated strictly to OWNER.** `@Roles('OWNER')` on the controller, `userRole !== 'OWNER' ⇒ return null` on the client component.
* **No verbose mode.** Per Decision 3 = recommendation B, only human-readable events are surfaced; raw audit noise stays in `audit_logs`.
* **Service writes both audit rows.** Failure to write is logged but never crashes the request — the timeline / export still returns.

---

## 10. Backlog

* **PR-LIA-12.1 — PDF export.** Needs a PDF library (puppeteer / pdfkit / @react-pdf/renderer) + a layout pass. The current renderers produce strings; the PDF path could either render via headless Chrome or compose pages programmatically. The headless route preserves the Markdown look at the cost of a heavy dependency; pdfkit is leaner but requires hand-laid layout.
* **PR-LIA-12.2 — Search within timeline.** Client-side `?q=…` filter that highlights matching events. Probably URL-driven so an OWNER's "deep link" to a specific message survives a page refresh.
* **PR-LIA-12.3 — Per-event filter chips.** "Only client messages" / "only decisions" / "exclude documents". Server-side query param (`?include=CLIENT_MESSAGE,DECISION_RECORDED`) would keep the response shape stable.
* **PR-LIA-12.4 — Per-LIA temporary export grants.** OWNER grants a specific LIA temporary export permission on a specific case ("Export this case file for the INZ liaison call tomorrow"). New model `CaseFileNoteExportGrant` with `(caseId, granteeUserId, grantedById, expiresAt)`; service checks for an active grant before rejecting a non-OWNER export.
* **Streaming exports for huge cases.** If any case crosses 5k events the current in-memory build will get sluggish. Move to a streaming Markdown renderer that emits events as they're loaded; backend would `res.write()` chunks.
* **Verbose mode toggle.** OWNER-only `?verbose=1` flag that includes the raw audit noise the current renderer skips (assignments without changes, stale-row sweeps, etc.). Useful for compliance retrospectives.
* **Audit-feed surface on the timeline.** Right now the page makes one server-render request. A follow-up could subscribe to changes (SSE / polling) so the timeline live-updates when a colleague writes a new note on the case. Refresh-based for now is fine.
* **Source-table denormalisation.** The `DOCUMENT_REVIEWED` event currently surfaces the `sourceRowId` rather than a resolved filename — looking up the filename means joining against three possible source tables. If LIAs report this as confusing, denormalise a `sourceFileName` snapshot column onto `CaseDocumentReview` so the join goes away.
* **External-share preset.** Once PDF export ships, an OWNER-only "Share with INZ" button could attach the PDF to a templated email. Out of scope here, but the file-note → email flow is a natural follow-up.
* **Multi-case bulk export.** Some OWNERs want a per-LIA quarterly archive. Filterable list view → ZIP of MD/PDF exports. Heavy lift but useful for audit retention.
* **`/health/case-file-note` route.** Returns latest 10 export timestamps + viewer identities so on-call OWNERs can spot anomalous export bursts.
* **Embedded file previews.** Currently a `DOCUMENT_UPLOADED` event shows the filename only. A thumbnail strip in the timeline would let the viewer recognise the file at a glance without clicking through.
