# PR-SUPPORT-1 — Staff-side ticket portal

## 1. What this phase does

Builds the staff-facing side of the existing client ticket system. The
client-side flow (`/students/me/tickets/*` opening, replying, and
closing their own tickets) already shipped in PR-DASH-2. This phase
adds the other half: an authenticated staff queue at `/staff/tickets`
with a per-ticket thread view, public replies, internal notes,
status changes, and assignment. It reuses the existing
`VisaSupportTicket` / `VisaSupportTicketMessage` schema unchanged —
the required columns (`assignedStaffId`, `isInternalNote`) were
already in place. Encryption, audit trail, and case-file-note
emission match the client-side conventions exactly.

## 2. Files created or changed

### Backend — new

| File | Purpose |
| --- | --- |
| [backend/src/staff/tickets/staff-tickets.module.ts](../backend/src/staff/tickets/staff-tickets.module.ts) | Module wiring (imports `PrismaModule`, `CryptoModule`). |
| [backend/src/staff/tickets/staff-tickets.controller.ts](../backend/src/staff/tickets/staff-tickets.controller.ts) | 6 endpoints under `/staff/tickets/*`, class-level `JwtAuthGuard + RolesGuard`, per-route `@Roles(...)`, message-rate-limit guard on `addMessage`. |
| [backend/src/staff/tickets/staff-tickets.service.ts](../backend/src/staff/tickets/staff-tickets.service.ts) | List / detail / reply / status / assign / assignees. Encrypt + decrypt via `CryptoService`. Transactional audit + `VisaCaseFileNote` emission. Decrypt-then-filter search. |
| [backend/src/staff/tickets/dto/staff-tickets.dto.ts](../backend/src/staff/tickets/dto/staff-tickets.dto.ts) | `class-validator` DTOs for reply / status / assign request bodies. |
| [backend/src/staff/tickets/guards/staff-ticket-message-rate-limit.guard.ts](../backend/src/staff/tickets/guards/staff-ticket-message-rate-limit.guard.ts) | 200 messages / hour / staff user (looser than the client's 60 / hour). |
| [backend/scripts/seed-test-ticket.ts](../backend/scripts/seed-test-ticket.ts) | One-off dev seed — bootstraps a `VisaCase` (if missing) and creates one OPEN ticket + opening client message. Safe to re-run. |

### Backend — modified

| File | Change |
| --- | --- |
| [backend/src/staff/staff.module.ts](../backend/src/staff/staff.module.ts) | Registers `StaffTicketsModule`. |
| [backend/package.json](../backend/package.json) | Added `"seed:test-ticket": "ts-node scripts/seed-test-ticket.ts"`. |

### Frontend — new

| File | Purpose |
| --- | --- |
| [frontend/src/app/staff/tickets/[id]/page.tsx](../frontend/src/app/staff/tickets/%5Bid%5D/page.tsx) | Detail page. Uses the non-async params pattern (`params: { id: string }`, no `Promise<>`, no `use()`) per the fix earlier this session. Header + Status / Assignment / Timestamps cards + thread + reply form with public/internal toggle. |
| [frontend/src/components/staff/tickets/StaffTicketMessages.tsx](../frontend/src/components/staff/tickets/StaffTicketMessages.tsx) | Staff-specific thread renderer. Built fresh because the existing `TicketMessage` is client-coupled (hardcoded "You" + no internal-note styling). Internal notes get an amber bubble + `Lock` icon label. |

### Frontend — modified

| File | Change |
| --- | --- |
| [frontend/src/app/staff/tickets/page.tsx](../frontend/src/app/staff/tickets/page.tsx) | Replaced the 6-line placeholder with the queue list: URL-state filters (status / department / assigned=me/unassigned / search), debounced search, desktop table + mobile cards, pagination, loading + empty states. |
| [frontend/src/components/staff/shell/StaffSidebar.tsx](../frontend/src/components/staff/shell/StaffSidebar.tsx) | Added `TICKETS_ROLES = ['OWNER','SUPER_ADMIN','ADMIN','SUPPORT','CONSULTANT','LIA']` and applied it as `roleGate` on the Tickets nav item (previously had no role gate — FINANCE would see the link and 403 on read). |

## 3. Database tables / columns

**No migration ran.** The schema was already complete from PR-DASH-2.
Relevant existing structures:

### `visa_support_tickets`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `clientId` | FK → `users.id` | The owning client. Cascade on delete. |
| `caseId` | FK → `visa_cases.id` | Required — tickets live under a VisaCase. Cascade on delete. |
| `assignedStaffId` | FK → `users.id`, nullable | **Reused by this PR.** Set / cleared via `PATCH /staff/tickets/:id/assign`. Set-null on staff deletion (preserves history). |
| `department` | enum `VisaTicketDepartment` | 6 values: ADMISSIONS, VISA_APPLICATION, DOCUMENTS, PAYMENTS_FINANCE, TECHNICAL_SUPPORT, GENERAL_INQUIRY. |
| `subjectEncrypted` | bytea | AES-256-GCM. |
| `status` | enum `VisaTicketStatus` | OPEN, IN_PROGRESS, RESOLVED, CLOSED. |
| `priority` | enum `VisaTicketPriority` | LOW, NORMAL, HIGH. |
| `lastClientMessageAt`, `lastStaffMessageAt` | timestamp, nullable | Bumped only by **public** message events. Internal notes intentionally don't touch these. |
| `resolvedAt`, `closedAt` | timestamp, nullable | Set when status transitions to RESOLVED / CLOSED. |
| `createdAt`, `updatedAt` | timestamp | |

### `visa_support_ticket_messages`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `ticketId` | FK → `visa_support_tickets.id` | Cascade on delete. |
| `authorId` | FK → `users.id` | |
| `authorRole` | enum `VisaTicketMessageAuthorRole` | CLIENT, STAFF, SYSTEM. Staff replies use `STAFF`. |
| `bodyEncrypted` | bytea | AES-256-GCM. |
| `isInternalNote` | boolean, default false | **Reused by this PR.** Set true for staff-only commentary; the client-side service still filters with `where: { isInternalNote: false }` so clients can't see them. |
| `createdAt`, `updatedAt` | timestamp | |

### `visa_case_file_notes`

Existing append-only case-file timeline. This PR writes `SYSTEM_EVENT`
rows for: public staff replies, status changes, and assignment
changes. Internal-note replies do **not** emit a file note (rationale
in §7).

## 4. Environment variables added

None. Uses the existing `ENCRYPTION_KEY` + `ENCRYPTION_KEY_VERSION`
already consumed by `CryptoService`.

## 5. Third-party services

None new.

## 6. How to test it works

### Seed a test ticket

```bash
cd backend
npm run seed:test-ticket
```

The script:
1. Bootstraps a `VisaCase` if none exists yet (walks
   `VisaApplication → AdmissionApplication → Case → Lead → Contact →
   User` to find a valid client).
2. Creates one OPEN / NORMAL / DOCUMENTS ticket with a real
   AES-256-GCM-encrypted subject + opening client message.
3. Prints the new ticket id and `/staff/tickets/:id` URL.

Safe to re-run — only the VisaCase creation is gated; tickets always
accumulate.

### End-to-end manual flow

Log in as a staff user with one of the ticket-reading roles (OWNER,
SUPER_ADMIN, ADMIN, SUPPORT, CONSULTANT, LIA):

1. **Queue list**: navigate to `/staff/tickets`. Filter by status,
   department, or `assigned=me / unassigned`. Search by subject
   substring. Confirm decrypted subjects appear, pagination works,
   and the empty state shows when filters return nothing.
2. **Detail**: click any row → `/staff/tickets/:id`. Confirm subject,
   client name + email, status / department / priority badges, full
   conversation, and Timestamps card all populate.
3. **Public reply**: type in the reply box, leave "Internal note"
   unchecked, click "Send reply". The thread refetches and shows the
   STAFF bubble on the right. The case-file timeline gains a
   `SYSTEM_EVENT` note. `lastStaffMessageAt` updates.
4. **Internal note**: type a reply, check "Internal note", click
   "Post internal note". The thread shows an amber-bordered bubble
   with a "Lock · Internal note · not visible to client" label.
   `lastStaffMessageAt` does NOT change. No `VisaCaseFileNote` row
   was created (verifiable via the case timeline).
5. **Status change**: change the dropdown to e.g. `IN_PROGRESS`,
   click "Save status". Header badge updates. Audit row +
   `SYSTEM_EVENT` file note written.
6. **Assign** (only visible if your role is `OWNER / SUPER_ADMIN /
   ADMIN / SUPPORT`): pick a staff user from the dropdown, click
   "Reassign". Header refreshes; assignment card shows new name +
   role. Audit row + file note written.

### Smoke-probe the API as unauth

```
GET    /staff/tickets             → 401
GET    /staff/tickets/abc         → 401
POST   /staff/tickets/abc/messages → 401
PATCH  /staff/tickets/abc/status  → 401
PATCH  /staff/tickets/abc/assign  → 401
```

## 7. Known limitations

- **Clients-only ticket creation.** Only `POST /students/me/tickets`
  exists. Staff cannot open a ticket on behalf of a client. The
  staff UI shows no "New ticket" button.
- **No SLA timers** anywhere — `lastClientMessageAt` is exposed in
  the timestamps card and on the list row but nothing colours
  "overdue" tickets or auto-escalates.
- **Priority is flat metadata.** `LOW / NORMAL / HIGH` exists on the
  schema and the badge shows it, but no logic sorts or routes by it.
  Triage is manual.
- **No canned responses / templates** for staff replies. Each reply
  is typed by hand.
- **Search is decrypt-then-filter, in-memory.** With ticket subjects
  encrypted at rest, the search query fetches the candidate set
  matching the other filters, decrypts every subject, then
  substring-matches in JS. Fine at launch volumes. At ~50k+
  tickets it becomes slow; a search-side index (Postgres GIN on a
  hash, or a separate search store) will be needed.
- **Internal-note file-note skip is by design.** Internal staff
  back-and-forth stays inside the ticket thread; the case-file
  timeline only sees client-facing events. The audit log still
  fires for traceability.
- **Pre-existing route collision on `/students/me/tickets/*`.** Two
  controllers register the same paths: the legacy
  `StudentsController` (`backend/src/students/students.controller.ts`,
  uses the legacy `Ticket` table) and the modern `TicketsController`
  (`backend/src/students/tickets/tickets.controller.ts`, uses
  `VisaSupportTicket`). NestJS picks one at module-registration time;
  the other becomes dead code. **This PR did NOT introduce this** —
  the collision exists from prior work. The staff side uses
  `/staff/tickets/*` so it doesn't collide, but the client-side
  ambiguity is worth resolving in a follow-up PR.
- **Per-row ownership is not narrowed on staff.** All 6 ticket-reader
  roles see every ticket. Narrowing to "only your assigned or
  case-touching tickets" can be added later if it becomes a privacy
  concern.

## 8. How a future developer would extend this

- **Staff-opened tickets**: add `POST /staff/tickets` to
  `staff-tickets.controller.ts` + a corresponding service method
  that takes `{ clientId, caseId, department, subject, initialMessage }`.
  The service can reuse the existing `crypto.encrypt` + `$transaction`
  block from `addStaffMessage` for the body, mirroring the
  client-side `createTicket` shape from `students/tickets/tickets.service.ts`.
  Add a "New ticket" CTA on `/staff/tickets/page.tsx`.
- **SLA timers**: add a cron module (similar to PR-LIA-9's visa
  expiry sweeper) that scans `OPEN / IN_PROGRESS` tickets where
  `lastStaffMessageAt < now - SLA_HOURS` and flags them. Surface as
  a colour on the queue list and a "overdue" filter.
- **Canned responses**: add a `TicketReplyTemplate` model
  (department + title + bodyEncrypted) and a small picker in the
  reply form. OWNER-editable via a new `/staff/platform-settings/`
  sub-section.
- **Search indexing**: add a deterministic hashed-token column
  (e.g. SHA-256 of each lowercased word in the subject, stored as
  `String[]`) and a Postgres GIN index on it. Query the hash from
  the server. Trade-off: only equality matches; no fuzzy.
- **Per-row ownership scoping**: change the list `where` clause to
  `OR: [{ assignedStaffId: actor.id }, { case: { assignments: { some: { staffId: actor.id, unassignedAt: null } } } }]`
  if you want staff to only see tickets they're directly involved in.

## 9. Security layers applied

| Layer | Where |
| --- | --- |
| **Role-gating (deny-by-default)** | Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` on [staff-tickets.controller.ts:39](../backend/src/staff/tickets/staff-tickets.controller.ts#L39). Per-route `@Roles(...)` enumerates the exact `UserRole` values allowed: 6-role read set on list/detail/reply/status ([lines 44, 67, 73, 79, 90](../backend/src/staff/tickets/staff-tickets.controller.ts#L44)), narrowed 4-role set on assign ([line 100](../backend/src/staff/tickets/staff-tickets.controller.ts#L100)). |
| **Frontend role gate on nav** | [`TICKETS_ROLES`](../frontend/src/components/staff/shell/StaffSidebar.tsx) applied as `roleGate` on the sidebar entry. FINANCE no longer sees the link. Defence in depth — backend still enforces. |
| **Conditional render of mutating UI** | The Assignment card is only mounted in the detail page when `me?.role` is in `OWNER / SUPER_ADMIN / ADMIN / SUPPORT` ([staff/tickets/[id]/page.tsx](../frontend/src/app/staff/tickets/%5Bid%5D/page.tsx) — `canAssign` flag). Roles that can't reassign never see the dropdown. |
| **Audit log on every mutation** | Reply ([staff-tickets.service.ts:262-276](../backend/src/staff/tickets/staff-tickets.service.ts#L262-L276)), status change ([lines 322-335](../backend/src/staff/tickets/staff-tickets.service.ts#L322-L335)), assign ([lines 376-388](../backend/src/staff/tickets/staff-tickets.service.ts#L376-L388)), detail view (best-effort, [lines 175-188](../backend/src/staff/tickets/staff-tickets.service.ts#L175-L188)). Each row carries `actorNameSnapshot + actorRoleSnapshot` so attribution survives user deletion. |
| **AES-256-GCM at the encrypt boundary** | Every body / subject text passes through `this.crypto.encrypt(...)` before persistence ([staff-tickets.service.ts:238, 343, 397](../backend/src/staff/tickets/staff-tickets.service.ts#L238)). Reads decrypt via `this.dec(...)` ([line 417](../backend/src/staff/tickets/staff-tickets.service.ts#L417)) — identical helper as the client-side service. |
| **Rate limit on staff replies** | `StaffTicketMessageRateLimitGuard` ([staff-ticket-message-rate-limit.guard.ts](../backend/src/staff/tickets/guards/staff-ticket-message-rate-limit.guard.ts)) — 200 messages / hour / staff user. Throws HTTP 429 with `messageKey: tickets.errors.staffMessageRateLimit`. |
| **Internal-note isolation** | Internal notes skip `VisaCaseFileNote` emission ([staff-tickets.service.ts:288-300](../backend/src/staff/tickets/staff-tickets.service.ts#L288)) — they never appear on the case-file timeline that any case-touching role reads. Internal notes also don't bump `lastStaffMessageAt` so the client UI never thinks a staff reply landed. |
| **JWT actor-id pattern preserved (d95640d)** | `req.user?.userId ?? req.user?.id` everywhere — [staff-tickets.controller.ts:107](../backend/src/staff/tickets/staff-tickets.controller.ts#L107). |
| **Defence-in-depth assignee validation** | The `assign` service method rejects unknown / inactive users and users whose role isn't in `STAFF_ASSIGNEE_ROLES` ([staff-tickets.service.ts:362-371](../backend/src/staff/tickets/staff-tickets.service.ts#L362-L371)) — even if the frontend dropdown is tampered with. |
| **Closed-ticket reply guard** | `addStaffMessage` rejects with 400 if the ticket is CLOSED ([staff-tickets.service.ts:225-227](../backend/src/staff/tickets/staff-tickets.service.ts#L225-L227)). |

## 10. Rollback instructions

This PR adds code only — no schema, no data migration, no env vars.
To roll back:

```
git revert <commit-hash>
git push origin main
# in the deployed environment:
npm install   # only needed if package.json regenerated
npx pm2 restart sorena-backend sorena-frontend
```

After revert:
- The `/staff/tickets` page returns to its 6-line placeholder
  (`<PlaceholderPanel section="Tickets" />`).
- All `/staff/tickets/*` API routes return 404 (controller no longer
  mounted).
- The sidebar entry continues to render but lands on the placeholder.
- The seed npm script is gone, but the file at
  `backend/scripts/seed-test-ticket.ts` is also gone after revert.
- No database changes to reverse. Tickets created during testing
  (including the seeded one) remain in `visa_support_tickets` and
  can be inspected via the still-functional `/students/me/tickets/*`
  client endpoints, or via SQL.
- The bootstrap `VisaCase` row created by the seed script is also
  preserved — it has no ill effect since it just represents an
  unassigned visa case for the Test Student user.
