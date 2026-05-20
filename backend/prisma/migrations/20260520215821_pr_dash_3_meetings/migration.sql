-- PR-DASH-3 — Meetings + transcripts (metadata + consultant notes).
--
-- Two tables + two enums on top of PR-DASH-2's tickets foundation.
-- File storage is still deferred — visa_meeting_transcripts stores
-- only originalFilename / mimeType / sizeBytes so a future PR can
-- attach the real blob without further schema churn.
--
-- locationOrLink / agenda / transcriptNotes are PII (free-text)
-- encrypted via CryptoService (AES-256-GCM, same envelope as the
-- rest of the project). They live as plain TEXT columns rather
-- than BYTEA because the service writes a base64-encoded cipher
-- string — keeps the column type compatible with Prisma's String
-- mapping and lets `prisma studio` show "(encrypted)" sentinel
-- text rather than a raw byte dump.
--
-- cancelledReason is cleartext per the spec — short admin-facing
-- label, not freely-typed PII.
--
-- FK rules:
--   * student / consultant → NO ACTION (a deleted user blocks
--     deletion until the meeting is hard-deleted manually; we
--     don't want meetings to silently disappear if a staff row
--     is removed).
--   * meeting on transcript → CASCADE (deleting the meeting
--     takes its transcript metadata with it).
--   * uploadedBy on transcript → NO ACTION (preserve attribution).
--
-- Hand-written, applied via `prisma migrate deploy` — same convention
-- as every prior PR. (The spec mentions `prisma migrate dev`, but
-- the project standard is hand-written migrations to keep `migrate
-- dev` from picking up unrelated drift.)

CREATE TYPE "VisaMeetingStatus" AS ENUM (
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
);

CREATE TYPE "VisaMeetingType" AS ENUM (
  'CONSULTATION',
  'FOLLOW_UP',
  'DOCUMENT_REVIEW',
  'ASSESSMENT'
);

CREATE TABLE "visa_meetings" (
  "id"               TEXT NOT NULL,
  "studentId"        TEXT NOT NULL,
  "consultantId"     TEXT,
  "scheduledAt"      TIMESTAMP(3) NOT NULL,
  "durationMinutes"  INTEGER NOT NULL DEFAULT 30,
  "status"           "VisaMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
  "meetingType"      "VisaMeetingType" NOT NULL DEFAULT 'CONSULTATION',
  "locationOrLink"   TEXT,
  "agenda"           TEXT,
  "transcriptNotes"  TEXT,
  "cancelledAt"      TIMESTAMP(3),
  "cancelledReason"  TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_meetings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_meetings_studentId_scheduledAt_idx"
  ON "visa_meetings"("studentId", "scheduledAt");
CREATE INDEX "visa_meetings_consultantId_scheduledAt_idx"
  ON "visa_meetings"("consultantId", "scheduledAt");
CREATE INDEX "visa_meetings_status_idx"
  ON "visa_meetings"("status");

ALTER TABLE "visa_meetings"
  ADD CONSTRAINT "visa_meetings_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "visa_meetings"
  ADD CONSTRAINT "visa_meetings_consultantId_fkey"
  FOREIGN KEY ("consultantId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "visa_meeting_transcripts" (
  "id"               TEXT NOT NULL,
  "meetingId"        TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType"         TEXT NOT NULL,
  "sizeBytes"        INTEGER NOT NULL,
  "uploadedById"     TEXT NOT NULL,
  "uploadedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visa_meeting_transcripts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visa_meeting_transcripts_meetingId_key"
  ON "visa_meeting_transcripts"("meetingId");
CREATE INDEX "visa_meeting_transcripts_uploadedById_idx"
  ON "visa_meeting_transcripts"("uploadedById");

ALTER TABLE "visa_meeting_transcripts"
  ADD CONSTRAINT "visa_meeting_transcripts_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "visa_meetings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_meeting_transcripts"
  ADD CONSTRAINT "visa_meeting_transcripts_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
