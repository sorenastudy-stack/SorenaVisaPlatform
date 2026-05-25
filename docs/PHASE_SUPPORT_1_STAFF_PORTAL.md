# PR-SUPPORT-1 — Staff Support Portal (backend endpoints + frontend portal)

The first staff-side surface for the existing `VisaSupportTicket` model. Student-side ticket creation and the client message thread shipped in PR-DASH-2; this PR adds the matching staff inbox so the SUPPORT team can actually read and respond to those tickets.

## 1. What this PR does

Adds a new role-gated `/support` portal in the frontend that consumes a new `staff/support/tickets` backend module. Together they give staff a full inbox: a dashboard with at-a-glance metrics (needs-attention / unassigned / open / mine), a filterable queue with URL-driven filters and search, and a detail page with a conversation thread, internal-note composer, assignment controls, status transitions, and priority changes.

This is the first staff-side use of the support-ticket model. PR-DASH-2 built the student write-path (ticket creation, message posting, basic encryption with `CryptoService`) but left the staff read-path as a stub. PR-SUPPORT-1 fills that gap without changing the schema: every field the staff view needs (`isInternalNote`, `lastClientMessageAt`, `lastStaffMessageAt`, `resolvedAt`, `closedAt`, decryptable `subjectEncrypted` + `bodyEncrypted`) already existed on `VisaSupportTicket` / `VisaSupportTicketMessage`.

SLA computation is a pure function in the service (HIGH = 4h, NORMAL = 24h, LOW = 72h). It is computed on read, never stored on the row — so the same DB state always yields the same answer regardless of how often the staff queue page is refreshed. Audit trail matches the student-tickets pattern exactly: every mutation writes both a `VisaCaseFileNote` (encrypted human-readable summary) and an `AuditLog` row (structured `oldValue`/`newValue` JSON).

No new env vars, no new packages, no DB migrations.

## 2. Files changed

Backend (new):
- `src/staff/support-tickets/staff-support-tickets.module.ts` — wires `PrismaModule` + `CryptoModule`, exports the service.
- `src/staff/support-tickets/staff-support-tickets.controller.ts` — mounted at `/staff/support/tickets`, guarded by `JwtAuthGuard` + `RolesGuard`, `@Roles('SUPPORT', 'ADMIN', 'SUPER_ADMIN')`. Seven routes (list, stats, detail, post message, assign, status, priority).
- `src/staff/support-tickets/staff-support-tickets.service.ts` — list / stats / detail / postMessage / assign / updateStatus / updatePriority. Owns the SLA pure function and the allowed-transition table.
- `src/staff/support-tickets/dto/staff-support-tickets.dto.ts` — `ListStaffTicketsQueryDto`, `StaffReplyDto`, `AssignTicketDto`, `UpdateStatusDto`, `UpdatePriorityDto`, plus the `StaffTicketStatusDto` / `StaffTicketPriorityDto` enum DTOs.

Backend (existing):
- `src/app.module.ts` — registers `StaffSupportTicketsModule`.

Frontend (new):
- `src/app/support/layout.tsx` — auth gate (redirects `/login?next=/support` if unauthenticated, `/unauthorized` if role not in `SUPPORT`/`ADMIN`/`SUPER_ADMIN`), wraps children in `PortalLayout portal="support"`.
- `src/app/support/_utils/format.ts` — pure helpers: `formatRelative`, `formatDate`, `formatDateTime`, `statusStyles`, `priorityStyles`, `statusLabel`, `priorityLabel`, `departmentLabel`, `slaChip`. No deps, no React.
- `src/app/support/page.tsx` — dashboard. Four stat cards (Needs Attention / Unassigned / Open / Assigned to me), recent SLA breaches list with empty-state, status breakdown tiles, quick-link cards.
- `src/app/support/tickets/page.tsx` — queue list with URL-driven filter chips (Status, Priority, Assignment, SLA, Department), server-rendered search form (preserves other filters as hidden inputs), active-filter badges with × dismiss links, responsive table (collapses to stacked cards under `sm`), pagination.
- `src/app/support/tickets/[id]/page.tsx` — detail page. Header with status + priority + SLA chip, two-column layout (conversation thread on the left, action cards on the right: Client, Assignment, Status, Priority, Timeline).
- `src/app/support/tickets/[id]/ReplyComposer.tsx` — client component. Textarea (min 10, max 5000), internal-note checkbox, calls `POST /messages`, `router.refresh()` on success.
- `src/app/support/tickets/[id]/AssignmentControls.tsx` — client component. "Assign to me" / "Unassign" buttons.
- `src/app/support/tickets/[id]/StatusControls.tsx` — client component. Status dropdown showing only the valid transitions for the current state.
- `src/app/support/tickets/[id]/PriorityControls.tsx` — client component. Three-button toggle (Low / Normal / High).

Frontend (existing):
- `src/components/portal/PortalLayout.tsx` — `Portal` union gains `'support'`, `NAV_CONFIG` gains the four support sidebar items (Dashboard, All Tickets, Unassigned, SLA Breaches), `PORTAL_TITLES` gains `support: 'Support Portal'`. Uses `LifeBuoy`, `Inbox`, `AlertTriangle` icons from `lucide-react` (which the package already exposes).

No new npm dependencies, no new env vars, no Prisma migrations.

## 3. Schema added

**None.** Zero migrations in PR-SUPPORT-1. All required fields already existed on `VisaSupportTicket` and `VisaSupportTicketMessage`:

- `VisaSupportTicket.subjectEncrypted` / `priority` / `status` / `department` / `assignedStaffId` / `lastClientMessageAt` / `lastStaffMessageAt` / `resolvedAt` / `closedAt` / `createdAt` / `updatedAt`
- `VisaSupportTicketMessage.bodyEncrypted` / `authorUserId` / `isInternalNote` / `createdAt`

The `isInternalNote` flag on `VisaSupportTicketMessage` already existed from PR-DASH-2; PR-SUPPORT-1 is the first surface that actually exposes it to a writer.

If a future PR adds `URGENT` to `VisaTicketPriority`, that *is* a migration. Out of scope here.

## 4. Endpoint contract

All routes are mounted under `/staff/support/tickets`, guarded by `JwtAuthGuard` + `RolesGuard`, restricted to `SUPPORT` / `ADMIN` / `SUPER_ADMIN`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/staff/support/tickets` | Paginated list. Query: `status`, `department`, `priority` (each comma-separated multi-select), `assignedStaffId` (cuid, or literal `"unassigned"`), `slaBreached=true`, `search`, `page`, `pageSize` (default 25, max 100). |
| GET | `/staff/support/tickets/stats` | Counts only. |
| GET | `/staff/support/tickets/:id` | Full detail incl. decrypted messages (internal notes included; staff role gates visibility upstream). |
| POST | `/staff/support/tickets/:id/messages` | Post staff reply or internal note. Body `{ body: string (10–5000), isInternalNote?: boolean }`. |
| PATCH | `/staff/support/tickets/:id/assign` | `{ staffId: string \| null }`. If assigning while status = `OPEN`, also flips status to `IN_PROGRESS` in the same transaction. |
| PATCH | `/staff/support/tickets/:id/status` | `{ status: 'OPEN' \| 'IN_PROGRESS' \| 'RESOLVED' \| 'CLOSED' }`. Allowed-transition matrix in §6. Sets `resolvedAt` on RESOLVED, `closedAt` on CLOSED, clears both on OPEN (reopen). |
| PATCH | `/staff/support/tickets/:id/priority` | `{ priority: 'LOW' \| 'NORMAL' \| 'HIGH' }`. |

### Filter conventions

- **Comma-separated multi-select** — `?status=OPEN,IN_PROGRESS` means "either open or in progress". Same for `priority` and `department`.
- **`assignedStaffId=unassigned`** — literal sentinel string. Returns rows where `assignedStaffId IS NULL`.
- **`assignedStaffId=<cuid>`** — exact match.
- **`slaBreached=true`** — only currently-breached rows (computed by the SLA pure function over the fetched page).
- **`search=<string>`** — substring (case-insensitive) over decrypted subject + client name + client email. Implemented in memory after a `prefetchTake = 500` fetch when `search` or `slaBreached` is present (see Known limitations).

### Sample responses

**List** (`GET /staff/support/tickets?status=OPEN&slaBreached=true&page=1`):

```json
{
  "data": [
    {
      "id": "clxsupp01...",
      "subject": "Question about Tier 4 documents",
      "department": "VISA_APPLICATION",
      "status": "OPEN",
      "priority": "HIGH",
      "client": { "id": "clxusr01...", "name": "Reza Ahmadi", "email": "reza@example.com" },
      "assignedStaff": null,
      "case": { "id": "clxcase01..." },
      "lastClientMessageAt": "2026-05-26T03:12:00.000Z",
      "lastStaffMessageAt": null,
      "unreadFromClient": true,
      "slaBreached": true,
      "slaDueAt": "2026-05-26T07:12:00.000Z",
      "createdAt": "2026-05-26T03:12:00.000Z",
      "updatedAt": "2026-05-26T03:12:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 1,
  "totalPages": 1
}
```

**Stats** (`GET /staff/support/tickets/stats`):

```json
{
  "total": 47,
  "open": 12,
  "inProgress": 8,
  "resolved": 18,
  "closed": 9,
  "byPriority": { "LOW": 14, "NORMAL": 27, "HIGH": 6 },
  "unassigned": 5,
  "slaBreached": 3,
  "myAssigned": 4
}
```

**Detail** (`GET /staff/support/tickets/:id`):

```json
{
  "id": "clxsupp01...",
  "subject": "Question about Tier 4 documents",
  "department": "VISA_APPLICATION",
  "status": "IN_PROGRESS",
  "priority": "HIGH",
  "client": { "id": "clxusr01...", "name": "Reza Ahmadi", "email": "reza@example.com" },
  "assignedStaff": { "id": "clxstaff01...", "name": "Aria Karimi" },
  "case": { "id": "clxcase01..." },
  "messages": [
    {
      "id": "clxmsg01...",
      "authorRole": "STUDENT",
      "authorDisplayName": "Reza Ahmadi",
      "body": "Hi, I'm not sure which CAS letter version is the latest.",
      "isInternalNote": false,
      "createdAt": "2026-05-26T03:12:00.000Z"
    },
    {
      "id": "clxmsg02...",
      "authorRole": "SUPPORT",
      "authorDisplayName": "Aria Karimi",
      "body": "I'll check with the LIA team and get back in 4h.",
      "isInternalNote": false,
      "createdAt": "2026-05-26T04:01:00.000Z"
    },
    {
      "id": "clxmsg03...",
      "authorRole": "SUPPORT",
      "authorDisplayName": "Aria Karimi",
      "body": "Reza is in the priority-review queue, flag this to LIA on Monday.",
      "isInternalNote": true,
      "createdAt": "2026-05-26T04:02:00.000Z"
    }
  ],
  "lastClientMessageAt": "2026-05-26T03:12:00.000Z",
  "lastStaffMessageAt": "2026-05-26T04:01:00.000Z",
  "resolvedAt": null,
  "closedAt": null,
  "slaBreached": false,
  "slaDueAt": "2026-05-26T07:12:00.000Z",
  "createdAt": "2026-05-26T03:12:00.000Z",
  "updatedAt": "2026-05-26T04:02:00.000Z"
}
```

Internal notes do **not** update `lastStaffMessageAt` (and therefore do not stop the SLA clock — the spec is "client is waiting on an external-visible reply"). Public staff replies do.

## 5. SLA semantics

Pure function in `staff-support-tickets.service.ts` — same input always produces same output, called on every list / stats / detail read.

```ts
const SLA_THRESHOLD_MS: Record<Priority, number> = {
  HIGH:   4  * 60 * 60 * 1000,  //  4 hours
  NORMAL: 24 * 60 * 60 * 1000,  // 24 hours
  LOW:    72 * 60 * 60 * 1000,  // 72 hours
};

function computeSla(ticket): { slaDueAt: Date | null; slaBreached: boolean } {
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    return { slaDueAt: null, slaBreached: false };
  }
  if (!ticket.lastClientMessageAt) {
    return { slaDueAt: null, slaBreached: false };
  }
  const lastStaff = ticket.lastStaffMessageAt?.getTime() ?? 0;
  const lastClient = ticket.lastClientMessageAt.getTime();
  if (lastStaff >= lastClient) {
    return { slaDueAt: null, slaBreached: false };
  }
  const threshold = SLA_THRESHOLD_MS[ticket.priority];
  const dueAt = new Date(lastClient + threshold);
  const breached = Date.now() - lastClient > threshold;
  return { slaDueAt: dueAt, slaBreached: breached };
}
```

| Priority | Threshold | Rationale |
|---|---|---|
| HIGH | 4h | Visible-impact issues — document blockers, payment failures during a deadline. |
| NORMAL | 24h | Standard inbox queries — most tickets land here. |
| LOW | 72h | Information requests, scheduling, anything not blocking. |

**Never breached when:** `status` is `RESOLVED` or `CLOSED`, or `lastClientMessageAt` is null, or `lastStaffMessageAt >= lastClientMessageAt` (staff has the last word).

**Breach is computed against "now"** on every read. There is no `slaBreachedAt` column — moving the threshold (e.g. adding URGENT at 1h) instantly re-evaluates the whole table.

## 6. Status transition matrix

| From ↓ / To → | OPEN | IN_PROGRESS | RESOLVED | CLOSED |
|---|---|---|---|---|
| **OPEN** | — | ✓ | ✓ | ✓ |
| **IN_PROGRESS** | ✓ | — | ✓ | ✓ |
| **RESOLVED** | ✓ | ✓ | — | ✓ |
| **CLOSED** | ✓ (reopen) | ✗ | ✗ | — |

`CLOSED` is terminal except for re-open back to `OPEN`. Implementation:

```ts
const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  OPEN:        ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED:    ['OPEN', 'IN_PROGRESS', 'CLOSED'],
  CLOSED:      ['OPEN'],
};
```

The frontend `StatusControls.tsx` enforces the same matrix client-side (the dropdown only shows valid next states). The backend re-validates and returns `400 BAD_TRANSITION` otherwise — never trust the client-side gate.

Side effects on transition:
- `→ RESOLVED` writes `resolvedAt = now()` (only if currently null; preserved on re-resolve).
- `→ CLOSED` writes `closedAt = now()` (same idempotence).
- `→ OPEN` clears both `resolvedAt` and `closedAt` (a reopened ticket is once again in-flight).
- All other transitions leave the timestamps untouched.

## 7. How to test (manual)

1. **Type-check clean:** `cd frontend && npx tsc --noEmit` exits clean. `cd backend && npx tsc --noEmit` exits clean.
2. **Login as a SUPPORT user.** Confirm the sidebar shows a "Support Portal" header with four items: Dashboard, All Tickets, Unassigned, SLA Breaches.
3. **Visit `/support`.** Verify the greeting includes your first name, the four stat cards render with current counts, and "Recent SLA breaches" lists tickets or shows the "All caught up" empty state. Network tab: `/staff/support/tickets/stats` and `/staff/support/tickets?slaBreached=true&pageSize=5` should both return 200.
4. **Visit `/support/tickets`.** Apply filters one at a time: Status → Open, then Priority → High, then Assignment → Mine, then SLA → Breached only. After each click the URL gains the corresponding query param and the result list refreshes. Active-filter badges appear above the table with × dismiss links.
5. **Search.** Type a partial subject or client email and submit. URL gains `search=...`, other filters remain (preserved as hidden inputs), results match.
6. **Pagination.** If the queue has more than one page, click "Next" — URL gains `page=2`, results change; "Previous" is enabled.
7. **Open a ticket detail.** Click "Open →" on any row. Header shows subject, case ID short, status badge, priority badge, SLA chip. Thread renders messages (client left, staff gold-tinted right, internal notes amber with lock icon). Right column shows Client, Assignment, Status, Priority, Timeline cards.
8. **Reply.** Type fewer than 10 chars — "Send reply" stays disabled. Type a longer message and click Send — the textarea clears, the new message appears in the thread after the page refreshes, and the Timeline's "Last staff message" updates.
9. **Internal note.** Tick the internal-note checkbox, type a note, send. Renders in the thread as an amber full-width card. The Timeline's "Last staff message" is **not** updated (verify the SLA chip stays the same as before the note).
10. **Assign / Unassign.** From an unassigned ticket click "Assign to me" — right card now shows your name with "(you)". Click "Unassign" — reverts to "Unassigned". If the ticket was `OPEN`, confirm the status badge in the header has flipped to `IN_PROGRESS` (auto-transition).
11. **Status & Priority.** Change status via the dropdown to In Progress → Resolved → Closed. From Closed, confirm the dropdown only offers "Open" (reopen). Toggle priority Low → Normal → High; the highlighted button updates and the header badge changes after refresh.
12. **Access control.** Log out and log in as a `STUDENT` — visiting `/support` redirects to `/unauthorized`. Visiting `/support/tickets/<id>` directly also redirects.

## 8. Known limitations

- **No bulk actions.** You cannot reassign 10 tickets at once or batch-close. Every mutation is one ticket at a time.
- **No staff-picker UI.** Assignment is "me" / "unassign" only. Assigning to *another* staff member requires a future PR with a user-search autocomplete; the backend already accepts any valid `staffId` so the wire shape is forward-compatible.
- **Search is in-memory.** `search=...` and `slaBreached=true` both require a post-fetch filter step. The service pre-fetches up to 500 rows (`prefetchTake = 500`) and filters in JS. Works fine at current scale (a few hundred lifetime tickets). At 100k+ tickets this would need either a search index (pg full-text on a separate encrypted-search table) or moving the SLA computation into a generated column.
- **No real-time updates.** Staff must refresh to see new client messages — no websocket / SSE layer. The `unreadFromClient` flag is computed at fetch time. A future PR can wire `Pusher` or native websockets if the volume justifies the infra.
- **No file attachments on staff replies.** `VisaSupportTicketMessage` has no `attachments` relation. The PR-SEC3 metadata-only file pattern is the obvious model to reuse when this becomes a need.
- **Internal notes have no per-staff read trail.** The `AuditLog` row captures `isInternalNote: true` in `newValue` at write time, but there is no "who has read this note" surface. Most ops teams don't need this; mention here so future-you doesn't think it's an oversight.
- **Priority enum is LOW / NORMAL / HIGH only.** `URGENT` is intentionally deferred — adding it touches the Prisma enum (migration), the SLA map, the priority DTO, and the three-button toggle in `PriorityControls.tsx`. See §9.
- **The "View case" link points to `/lia/cases/<caseId>`.** Fine for SUPPORT users who are *also* in `LIA`/`ADMIN`/`SUPER_ADMIN`, but a SUPPORT-only user will hit the LIA layout's role gate and be redirected to `/unauthorized`. Acceptable for now; a future PR can ship a SUPPORT-readable case-view route.
- **No SLA pause / exception.** Tickets can't be put on hold (e.g. "waiting for student passport scan, don't count the next 5 days against us"). When this becomes a real need, add `slaPausedAt` + extend `computeSla` to early-return.

## 9. How to extend

- **Add a staff-picker for assignment.** Build a `/api/staff/users?role=SUPPORT,ADMIN` autocomplete endpoint (probably an extension of the existing `/staff/users` list in PR-CONSULT-3). Swap `AssignmentControls.tsx` for a component that wraps a combobox + the existing PATCH call. Backend already accepts any `staffId`.
- **Add bulk actions.** Extend `tickets/page.tsx` with row checkboxes and a sticky bulk-action bar. New endpoint: `POST /staff/support/tickets/bulk` accepting `{ ticketIds: string[], action: 'assign' | 'status' | 'priority', value: ... }`. Service should run the same per-ticket logic in a single transaction with a per-action audit row.
- **Add URGENT priority.** Migration: `ALTER TYPE "VisaTicketPriority" ADD VALUE 'URGENT'`. Extend `SLA_THRESHOLD_MS` with `URGENT: 1 * 60 * 60 * 1000`. Update `StaffTicketPriorityDto`. Extend `PriorityControls.tsx` from a three-button to four-button toggle. The list endpoint's `priority` filter is comma-separated — no shape change.
- **Add file attachments.** Extend `VisaSupportTicketMessage` with `attachments VisaCaseFile[]`. Reuse the existing PR-SEC3 metadata-only file pattern (upload → signed URL → metadata row → reference from the message body via `attachments` relation). Decrypt + serve through the existing per-file `GET /files/:id/signed-url` route.
- **Add SLA pause / exception.** New nullable `slaPausedAt` on `VisaSupportTicket`. `computeSla` early-returns `{ slaDueAt: null, slaBreached: false }` when set. Resume by clearing it (and optionally pushing `slaDueAt` forward by the pause duration — adds a `slaPausedDurationMs` accumulator column).
- **Add a real-time layer.** Wire `Pusher` (already a dependency in the chatbot PR) on `POST /messages` and on every PATCH. Frontend subscribes per `ticket.id`; `router.refresh()` on receipt.

## 10. Security layers applied

- **Layer 1 — Auth.** `src/app/support/layout.tsx` calls `getSession()` and redirects to `/login?next=/support` if absent. Backend controller uses `JwtAuthGuard` on every route.
- **Layer 2 — Role gate.** Backend: `@Roles('SUPPORT', 'ADMIN', 'SUPER_ADMIN')` + `RolesGuard`. Frontend layout re-checks the same set and redirects to `/unauthorized` if mismatched. Two-layer defence (frontend gate is UX; backend gate is authoritative).
- **Layer 3 — Env vars.** No new env vars. Encryption (`ENCRYPTION_KEY`) and DB URL already in place. Misconfigured backend (no `ENCRYPTION_KEY`) fails closed via the existing `CryptoService` boot check.
- **Layer 4 — HTTPS.** Production enforced by the Vercel + Railway deploy; no code.
- **Layer 5 — Rate limiting.** **Deliberately not applied** to staff endpoints. Internal-user surface, low volume, friction from a misfired throttler costs more than the abuse it prevents. The platform-wide 60/min global throttler default still applies as a backstop. If a future PR adds an external SUPPORT-API integration, the new route should opt back in with `@Throttle(...)`.
- **Layer 6 — Audit log.** Every mutation writes both a `VisaCaseFileNote` (encrypted human-readable summary, `noteType = TICKET` or `SYSTEM_EVENT`) and an `AuditLog` row with structured `oldValue` / `newValue` JSON. Matches the student-tickets service pattern exactly.
- **Layer 7 — File uploads.** N/A — no file uploads in this PR.
- **Layer 8 — Auto-logout.** Handled by the existing session-expiry middleware; no change here.
- **Layer 9 — npm audit.** No new dependencies. `npm audit` baseline is unchanged.
- **Layer 10 — DB backups.** No schema changes → no backup needed beyond the existing nightly Postgres routine.

Encryption note: subject and message body remain `Bytes` columns encrypted via `CryptoService` (AES-256-GCM, base64 envelope). Decryption happens server-side inside the service; the wire response is plaintext. Internal notes use the same encryption path as public messages — the `isInternalNote` flag is a row-level boolean, not a separate crypto domain.

## 11. Rollback procedure

```bash
# 1. revert the three commits (backend feat + frontend feat + handover)
git log --oneline -5            # confirm the top three are the PR-SUPPORT-1 commits
git revert HEAD~2..HEAD         # adjust range if more commits landed since

# 2. push the revert
git push origin main
```

No database migration to roll back — there are none.

**Verification after rollback:**

```bash
cd backend && npx tsc --noEmit          # clean
cd frontend && npx tsc --noEmit         # clean
curl -i http://localhost:3001/staff/support/tickets   # → 404 (route gone)
```

In production, the rollback removes the staff inbox UI but leaves `VisaSupportTicket` rows untouched — students can still create tickets via the existing PR-DASH-2 paths, they just won't be answered until a forward-fix or re-deploy. If the rollback is being applied because tickets are *actively being mishandled* (e.g. wrong audit attribution), pair it with a temporary `feature-flag` / placeholder banner in the student dashboard noting that the support inbox is offline; otherwise the existing nightly digest to ops is the fallback channel.
