# PR-DASH-3 — Meetings + transcripts (metadata + notes)

Handover for the meetings feature that landed on `main` as commit `c2257bc`.

## 1. What this PR does

Sorena consultants can now schedule, edit, cancel, and complete client consultations from a dedicated `/consultant/meetings` page, and attach transcript file metadata plus type free-form transcript notes after the session. Students see their own meetings at `/student/meetings`: an opening list, a click-through detail overlay, and a "Book a meeting" button that surfaces a Wix booking URL when the operator has set one. Both sides go through the same backend service; the student-side queries enforce ownership at the database layer (404 on not-owned to avoid existence leaks), the consultant-side queries are unconstrained but role-gated and rate-limited. Transcripts are metadata-only at launch — no file bytes ever reach the backend (same pattern as PR-13 / PR-14 supporting documents).

## 2. Files changed

Backend (new module under `backend/src/students/meetings/`):
- `meetings.module.ts` — module wiring; imports PrismaModule, CryptoModule, ConfigModule.
- `meetings.controller.ts` — student-side, `/api/student/meetings/*`.
- `meetings.consultant.controller.ts` — consultant-side, `/api/consultant/meetings/*`.
- `booking-config.controller.ts` — surfaces `WIX_BOOKING_URL` over `/api/student/booking-config`.
- `meetings.service.ts` — all reads, writes, encryption, audit emit.
- `dto/create-meeting.dto.ts`, `dto/update-meeting.dto.ts`, `dto/attach-transcript.dto.ts`, `dto/transcript-notes.dto.ts`, `dto/list-query.dto.ts`.
- `guards/meetings-rate-limit.guards.ts` — student-list + consultant-write guards.

Backend (existing):
- `prisma/schema.prisma` — added `VisaMeeting`, `VisaMeetingTranscript`, `VisaMeetingStatus`, `VisaMeetingType`, and three back-relations on `User`.
- `prisma/migrations/20260520215821_pr_dash_3_meetings/migration.sql` — hand-written DDL.
- `src/students/students.module.ts` — registered `MeetingsModule`.
- `src/students/dashboard/dashboard.module.ts` + `dashboard.service.ts` — injected `MeetingsService` and added a `meetings: { upcomingCount, next }` block to the dashboard payload.
- `.env.example` — `WIX_BOOKING_URL` placeholder added in the previous flight; still present here.

Frontend (new):
- `src/app/student/meetings/page.tsx` — student list page.
- `src/app/consultant/meetings/page.tsx` — consultant list page.
- `src/components/student/meetings/` — `MeetingsList`, `MeetingDetailOverlay`, `MeetingsCard`, `MeetingStatusBadge`, `BookMeetingButton` (5 components).
- `src/components/consultant/meetings/` — `ConsultantMeetingsList`, `ConsultantMeetingDetailOverlay`, `MeetingFormOverlay`, `CancelMeetingOverlay`, `TranscriptMetadataPicker`, `TranscriptNotesEditor` (6 components).

Frontend (existing):
- `src/app/student/dashboard/page.tsx` — swapped the "Meetings — coming soon" placeholder for the live `MeetingsCard`.
- `src/components/dashboard/PlaceholderCards.tsx` — removed `MeetingsPlaceholderCard`.
- `src/i18n/messages/{en,fa}.json` — 25 new keys under `meetings.*`.
- `.env.example` — added `NEXT_PUBLIC_WIX_BOOKING_URL` placeholder.

## 3. Schema added

```prisma
enum VisaMeetingStatus { SCHEDULED COMPLETED CANCELLED NO_SHOW }
enum VisaMeetingType   { CONSULTATION FOLLOW_UP DOCUMENT_REVIEW ASSESSMENT }

model VisaMeeting {
  id, studentId, consultantId?, scheduledAt, durationMinutes(=30),
  status, meetingType,
  locationOrLink?, agenda?, transcriptNotes?,   // all encrypted (TEXT base64)
  cancelledAt?, cancelledReason?,               // cleartext label
  createdAt, updatedAt,
  @@index([studentId, scheduledAt])
  @@index([consultantId, scheduledAt])
  @@index([status])
}

model VisaMeetingTranscript {
  id, meetingId @unique, originalFilename, mimeType, sizeBytes,
  uploadedById, uploadedAt
}
```

FK rules: `student`/`consultant`/`uploadedBy` are `NO ACTION` (preserves history if a user is removed administratively); `meeting → transcript` cascades.

Encryption pattern: `locationOrLink` / `agenda` / `transcriptNotes` are stored as base64-encoded AES-256-GCM ciphertext in nullable TEXT columns. `MeetingsService.enc()` / `dec()` wrap the CryptoService at the boundary.

## 4. Environment variables

- **`WIX_BOOKING_URL`** (backend, `backend/.env`) — public Wix booking calendar URL. Reading: surfaced via `GET /api/student/booking-config`. When unset/empty, the booking endpoint returns `{ wixBookingUrl: null }` and the frontend hides the button.
- **`NEXT_PUBLIC_WIX_BOOKING_URL`** (frontend, `frontend/.env`) — placeholder only; reserved for a future client-only fallback. Left empty in this PR.

Encryption uses the existing `ENCRYPTION_KEY` env var (introduced in earlier PRs). No new backend env vars required.

## 5. Services + endpoints

**Student-side** (`/api/student/meetings`, role `STUDENT`):
- `GET /` — list own meetings. Filters: `?status=SCHEDULED,COMPLETED`, `?from=ISO`, `?to=ISO`. Sorted `scheduledAt DESC`.
- `GET /:id` — detail of own meeting. 404 if not owned.

**Consultant-side** (`/api/consultant/meetings`, roles `SUPER_ADMIN / ADMIN / OPERATIONS / LIA / SUPPORT`):
- `GET /` — list all. Filters: `?studentId=…`, `?status=`, `?from=`, `?to=`.
- `GET /:id`
- `POST /` — create. Body: `{ studentId, scheduledAt, durationMinutes?, meetingType, locationOrLink?, agenda? }`. Validates that `studentId` references a `STUDENT` user.
- `PATCH /:id` — update fields (NOT `studentId`).
- `POST /:id/cancel` — body: `{ reason? }`. Idempotent.
- `POST /:id/complete` — idempotent.
- `POST /:id/transcript-metadata` — replace-on-upload metadata. Body: `{ originalFilename, mimeType, sizeBytes }`. MIME whitelist: audio/mpeg, audio/mp4, audio/wav, audio/webm, audio/ogg, video/mp4, video/webm, text/plain, text/vtt, application/pdf. ≤ 25MB. Filename ≤ 255 chars.
- `DELETE /:id/transcript-metadata` — idempotent.
- `PUT /:id/transcript-notes` — body: `{ transcriptNotes }`, ≤ 50,000 chars. Encrypted server-side.

**Booking config** (`/api/student/booking-config`, role `STUDENT`) — returns `{ wixBookingUrl: string | null }`.

**Audit events** (`eventType` column on `audit_logs`): `MEETING_CREATED`, `MEETING_UPDATED`, `MEETING_CANCELLED`, `MEETING_COMPLETED`, `MEETING_TRANSCRIPT_METADATA_ATTACHED`, `MEETING_TRANSCRIPT_METADATA_REMOVED`, `MEETING_TRANSCRIPT_NOTES_UPDATED`.

## 6. How to test (manual)

1. **Migration applied:** `cd backend && npx prisma migrate status` — should show `20260520215821_pr_dash_3_meetings` applied.
2. **Backend builds:** `cd backend && npx tsc --noEmit` — exits clean.
3. **Frontend builds:** `cd frontend && npx tsc --noEmit` — exits clean.
4. **Student view, no meetings:** log in as a STUDENT, visit `/student/meetings` — see the empty-state copy. If `WIX_BOOKING_URL` is set on the backend, the "Book a meeting" button shows.
5. **Consultant flow:** log in as a SUPPORT/LIA/ADMIN user, visit `/consultant/meetings`, click "Create meeting", fill in a real student id + future date + type → save. The row appears in the list.
6. **Attach + notes:** click the row to open the detail overlay → pick a small PDF or VTT for the transcript → enter some notes; verify "Saved {time}" indicator after the 1s debounce. Notes round-trip on reload.
7. **Student detail:** back on the student account, refresh `/student/meetings`, click the row — overlay shows the transcript metadata + the decrypted notes.
8. **Cancel:** consultant clicks the X icon on a row → enter an optional reason → confirm. Student now sees the cancelled banner with the reason in their detail overlay.
9. **Ownership:** call `GET /api/student/meetings/{other-student-id}` with a STUDENT token — expect 404.
10. **Dashboard summary card:** `/student/dashboard` shows the Meetings card with the upcoming count + the next meeting's date and consultant initial.

## 7. Known limitations

- **No file bytes anywhere.** Transcript download UI is intentionally absent for students. Backfilling against existing rows is PR-15's job.
- **No Sorena-side booking UI.** Students book through Wix. The `wixBookingId` field that briefly existed in an earlier draft is gone.
- **No Zoom API integration.** Consultants paste links manually into `locationOrLink`.
- **No status-transition checks at the model layer.** The service exposes only `/cancel` and `/complete` endpoints for status changes; no `PATCH /:id` route accepts a raw `status` field. Out-of-band SQL could still set anything; the audit trail catches it.
- **No reschedule flow as a first-class action.** Edit the row's `scheduledAt` instead.
- **Consultant role list is hard-coded.** `SUPER_ADMIN, ADMIN, OPERATIONS, LIA, SUPPORT`. Updating means a code change.
- **No realtime push.** Both pages render with a server fetch + post-mutation `window.location.reload()` — simple, but it loses scroll position. A future PR can swap to `router.refresh()` with optimistic updates.

## 8. How to extend

- **Wire actual file storage.** PR-15 adds Supabase Storage. The migration to attach blobs is additive — the existing metadata rows stay, and a `storagePath` column gets added to `visa_meeting_transcripts`.
- **Add a Calendly / Zoom integration.** Replace the `WIX_BOOKING_URL` env with a structured booking config and add a `wixBookingId` / `externalBookingId` column to dedupe webhook calls.
- **Add a `RESCHEDULED` audit event.** Currently `MEETING_UPDATED` is the catch-all. Splitting it would require detecting field-level changes in `consultantUpdate` and emitting the more specific event.
- **Add student-side cancel.** Today only consultants can cancel. Adding a student-side `POST /api/student/meetings/:id/cancel` is a matter of adding a route, an ownership check, and an audit event. The schema already supports it.
- **Surface the file note timeline.** PR-DASH-2 introduced `VisaCaseFileNote` for tickets. We chose NOT to write meeting events to that table in this PR (per the spec's redesign), but a future "consultant case file" view could.

## 9. Security layers applied

- **Layer 1 — auth:** JwtAuthGuard + RolesGuard on every route. Student-side `@Roles('STUDENT')`; consultant-side `@Roles('SUPER_ADMIN','ADMIN','OPERATIONS','LIA','SUPPORT')`.
- **Layer 2 — RLS / ownership:** every student-side query filters by `studentId = req.user.userId`. Not-owned returns 404 (not 403) to avoid existence leaks.
- **Layer 3 — input validation:** class-validator DTOs on every backend body / query. zod + react-hook-form on the consultant create/edit form. MIME whitelist + size cap on the transcript picker, enforced both client and server side.
- **Layer 4 — encryption at rest:** AES-256-GCM via existing `CryptoService` on `locationOrLink`, `agenda`, `transcriptNotes`. Cleartext only on the wire to the authenticated owner; cleartext only on the disk after `dec()`.
- **Layer 5 — rate limiting:** DB-count guards (same pattern as PR-DASH-2 tickets). Student-list 120/min/user; consultant writes 50/hour/user.
- **Layer 6 — audit log:** every mutation writes a structured `eventType` to `audit_logs`. Seven event types defined; consumed by the dashboard activity feed in a future PR.
- **Layer 7 — Zoom URL leak protection:** the Zoom URL lives unencrypted in `locationOrLink` (encrypted column, decrypted at the boundary) and is returned only to authenticated owners. We do NOT redact based on a join window — the PR-DASH-3 spec dropped that constraint compared to earlier drafts. If the operator wants redaction, add it in `serializeMeeting`.
- **Layer 8 — booking URL leak protection:** the Wix URL lives on the backend env var only and is fetched at runtime by authenticated clients; never baked into the static JS bundle.

## 10. Rollback procedure

```bash
# 1. revert the feature commit
git revert c2257bc

# 2. drop tables + enums (run as the DB owner)
psql -d sorena_visa <<SQL
DROP TABLE IF EXISTS visa_meeting_transcripts CASCADE;
DROP TABLE IF EXISTS visa_meetings CASCADE;
DROP TYPE  IF EXISTS "VisaMeetingType";
DROP TYPE  IF EXISTS "VisaMeetingStatus";
DELETE FROM _prisma_migrations WHERE migration_name = '20260520215821_pr_dash_3_meetings';
SQL

# 3. push the revert
git push origin main
```

The DB backup taken before the migration applied lives at `backend/backup_before_pr_dash_3.sql` (gitignored) — restore from it if anything goes sideways during the rollback.
