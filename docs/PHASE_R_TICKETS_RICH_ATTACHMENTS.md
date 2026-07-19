# PHASE-R — Tickets: rich-text replies, attachments, 24h alert, cycle-scoped reassign

Four extensions to the staff/client support-ticket system (`VisaSupportTicket` /
`VisaSupportTicketMessage`): rich-text staff replies, file attachments, a red
"no reply 24h+" alert, and reassignment restricted to the ticket's case cycle.
One additive migration; no new endpoints beyond an attachment upload.

## 1. What this PR does

- **Rich-text replies** — staff reply with the shared `RichTextEditor` (bold /
  italic / underline / lists / links; **no** images, no voice). HTML is
  **sanitized server-side then encrypted** into the existing `bodyEncrypted`.
- **Attachments** — image (JPG/PNG/WebP) + PDF, ≤10 MB, ≤5 per message, uploaded
  to R2 and rendered as thumbnails / file chips with short-lived signed URLs.
- **24h alert** — a computed `unansweredOver24h` flag drives a red badge on the
  list rows and the detail header. No new column, no cron.
- **Cycle-scoped reassign** — "any staff member can reassign," but **only to
  someone already on the ticket's VisaCase** (active `VisaCaseAssignment` rows +
  `assignedConsultantId`). Enforced server-side.
- Client-side thread updated so clients render staff HTML + attachments (not raw
  tags).

## 2. Deliberate: VisaCase, NOT the operational Case

Tickets hang off **`VisaCase`**. The operational **`Case`** (with the 5 scalar
slots `liaId/ownerId/consultantId/supportId/financeId`) is a **separate, deliberately
un-bridged** model — the only link between them is a fuzzy *per-client* join
(`Case → lead → contact → contact.userId === VisaCase.clientId`), which is
per-client, not per-case. So:

- **The ticket "assignment cycle" = the VisaCase's assigned staff:** active
  `VisaCaseAssignment` rows (roleSlot ∈ LIA/CONSULTANT/SUPPORT/FINANCE) **plus**
  the scalar `assignedConsultantId`. This is resolved by
  `caseCycleStaffIds(caseId)` in the staff service.
- **The case-detail Tickets tab stays a pointer** (→ `/staff/tickets`). It lives
  on the *operational Case* detail page, and there is no clean per-case link to
  a VisaCase's tickets, so building a real per-case list there would require
  faking a link. Left as-is by design (see §7).

## 3. Data model (additive)

`VisaSupportTicketMessage` gains two columns (migration
`20260720120000_ticket_message_rich_attachments`):

| Column | Type | Meaning |
|---|---|---|
| `bodyIsHtml` | `BOOLEAN NOT NULL DEFAULT false` | true → `bodyEncrypted` holds sanitized rich-text HTML (staff replies); false → plain text (all existing rows + client messages), rendered as escaped text |
| `attachments` | `JSONB` (nullable) | array of `{ key, name, mime, size }`; the R2 `key` is private (reads mint a signed URL) |

No change to `bodyEncrypted` (rich HTML is sanitized → encrypted into it). No
`Ticket`/`TicketMessage` (the unused legacy model) change. Additive & reversible
(`DROP COLUMN`).

## 4. Files changed

- **Migration:** `prisma/schema.prisma` (2 fields on `VisaSupportTicketMessage`) +
  `prisma/migrations/20260720120000_ticket_message_rich_attachments/migration.sql`.
- **Backend — staff:** `staff/tickets/staff-tickets.service.ts` (sanitize+encrypt
  reply, `bodyIsHtml`, attachments validate/store/sign, `unansweredOver24h`,
  `caseCycleStaffIds`, `listAssignees(ticketId)`, cycle-gated `assign`,
  `uploadAttachment`), `staff-tickets.controller.ts` (`:id/assignees`,
  `POST :id/attachments`, widened `assign`/message roles to all ticket roles),
  `dto/staff-tickets.dto.ts` (`attachments`), `staff-tickets.module.ts` (R2).
- **Backend — client:** `students/tickets/tickets.service.ts` (return
  `bodyIsHtml` + signed `attachments`), `tickets.module.ts` (R2).
- **Frontend — staff:** `app/staff/tickets/[id]/page.tsx` (RichTextEditor
  composer + attachment upload/chips, HTML thread, 24h header badge, per-ticket
  assignee fetch, widened `ASSIGN_ROLES`), `components/staff/tickets/StaffTicketMessages.tsx`
  (render HTML + attachments), `app/staff/tickets/page.tsx` (24h list badges).
- **Frontend — client:** `components/tickets/TicketMessage.tsx` +
  `TicketMessageThread.tsx` (render staff HTML + attachments).
- **Test (gitignored):** `backend/scripts/test-tickets-rich.ts`.

## 5. Configuration

- Uses the existing **R2** env (`R2_BUCKET_NAME`, …) — the same bucket staff
  photos / case docs use. No new env.
- **Additive migration** applied by the pre-deploy `migrate:deploy`.

## 6. How to test

`backend/scripts/test-tickets-rich.ts` — **19/19 PASS** (run from `backend/`):

- **Rich text:** an XSS payload (`<script>`, `<img onerror>`, `javascript:` link)
  is stripped; safe `<b>` + `https` link survive with `rel="noopener…"`; the
  reply stores `bodyIsHtml=true` (decrypts to sanitized HTML) and bumps
  `lastStaffMessageAt`.
- **Attachments:** `uploadAttachment` returns a per-ticket key; an
  attachment-only message (no text) is allowed; detail returns a signed URL;
  empty body + no attachment → 400; an attachment key not belonging to the ticket
  → 400.
- **Cycle reassign:** `listAssignees` returns exactly the VisaCase cycle (its
  assignment rows + `assignedConsultantId`), excludes an outsider; assigning a
  cycle member succeeds; assigning an outsider → **403** and does not take effect.
- **24h flag:** true when a client message has waited >24h unanswered; false once
  staff reply after the client; false when the ticket is CLOSED/RESOLVED.

`nest build` clean; frontend `tsc` clean. (Pre-existing unrelated errors in three
old `scripts/*.ts` are excluded from the build.)

## 7. Known limitations / deliberate exclusions

- **Case-detail Tickets tab remains a pointer** — no clean operational-Case ↔
  VisaCase per-case link exists (only a per-client join), so a real per-case list
  can't be resolved there without faking a link. Left pointing at `/staff/tickets`.
- **No inline images in the body** — the sanitizer keeps stripping `<img>`;
  images are attachments, rendered under the message. (Deliberate — avoids
  loosening the XSS allowlist.)
- **Client replies stay plain text** — only staff compose rich text; client
  messages render as escaped text (`bodyIsHtml=false`).
- **Legacy staff plain-text messages** (pre-migration, `bodyIsHtml=false`) render
  as escaped text — safe, just unformatted.
- **English-only** composer/labels.

## 8. How to extend

- **Client attachments/rich text:** the client `addMessage` path can adopt the
  same sanitize+`bodyIsHtml` and `uploadAttachment` pattern.
- **Alert threshold:** change `ALERT_AFTER_MS` in `staff-tickets.service.ts`.
- **Attachment types/limits:** edit `ATTACH_ALLOWED_MIMES` / `ATTACH_MAX_BYTES` /
  `MAX_ATTACHMENTS_PER_MESSAGE` (service) and the multer config (controller).

## 9. Security

- **Rich text sanitized server-side** against the shared allowlist BEFORE
  encryption (`rich-text-sanitizer.ts`) — client HTML is never trusted; scripts /
  `on*` / `javascript:` / `<img>` are stripped; links hardened `rel="noopener
  noreferrer nofollow"`. Bodies stay **encrypted at rest** (`bodyEncrypted`).
- **Attachments:** type + size validated at multer AND on the bytes; the R2 key
  is namespaced per ticket and a message can only reference keys under its own
  ticket (`validateAttachments` prefix check) — no attaching an arbitrary object.
  Reads return only short-lived signed URLs, never the key.
- **Reassign:** widened to all ticket-access roles for WHO can act, but the target
  is re-validated against the live VisaCase cycle on every assign (server-side) —
  the picker only lists cycle members, but the service is the boundary.
- **Audited:** replies (`TICKET_MESSAGE_SENT`), assignments (`TICKET_ASSIGNED`),
  attachment uploads (`TICKET_ATTACHMENT_UPLOADED`).

## 10. Rollback procedure

- **Code:** revert the commit — composer returns to plain textarea, attachments
  and the 24h badge disappear, reassign reverts to the all-staff picker.
- **Data/schema:** the migration is additive — to fully roll back,
  `ALTER TABLE "visa_support_ticket_messages" DROP COLUMN "bodyIsHtml", DROP COLUMN "attachments";`.
  Existing messages are unaffected (bodies remain in `bodyEncrypted`); any rich
  replies written meanwhile would then render as escaped text (their HTML shows as
  tags) — acceptable and non-destructive. Uploaded R2 objects are orphaned but
  harmless. Frontend/backend roll back independently.
