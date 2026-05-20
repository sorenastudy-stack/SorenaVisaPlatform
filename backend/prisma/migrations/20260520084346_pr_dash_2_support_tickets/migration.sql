-- PR-DASH-2 — Support tickets + VisaCaseFileNote.
--
-- Adds three tables + five enums on top of PR-DASH-1's VisaCase /
-- AssessmentReport. All free-text PII columns (subject, body,
-- summary) are BYTEA and encrypted via CryptoService (AES-256-GCM,
-- same envelope as the rest of the project).
--
-- FK rules:
--   * client / case → CASCADE (a deleted student takes their
--     tickets with them).
--   * assignedStaff → SET NULL (a deleted consultant un-assigns
--     their open tickets but doesn't delete them).
--   * createdBy on file notes → SET NULL (system-generated notes
--     never had an author).
--
-- Indexes follow the spec — composite (clientId, status) drives
-- "my open tickets" queries, (assignedStaffId, status) drives the
-- future staff inbox, (caseId, createdAt) drives the consultant
-- file-note timeline.
--
-- Hand-written, applied via `prisma migrate deploy` — same convention
-- as every prior PR-VISA* / PR-DASH-1 migration.

CREATE TYPE "VisaTicketDepartment" AS ENUM (
  'ADMISSIONS',
  'VISA_APPLICATION',
  'DOCUMENTS',
  'PAYMENTS_FINANCE',
  'TECHNICAL_SUPPORT',
  'GENERAL_INQUIRY'
);

CREATE TYPE "VisaTicketStatus" AS ENUM (
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED'
);

CREATE TYPE "VisaTicketPriority" AS ENUM (
  'LOW',
  'NORMAL',
  'HIGH'
);

CREATE TYPE "VisaTicketMessageAuthorRole" AS ENUM (
  'CLIENT',
  'STAFF',
  'SYSTEM'
);

CREATE TYPE "VisaCaseFileNoteType" AS ENUM (
  'TICKET',
  'MEETING_TRANSCRIPT',
  'CONSULTANT_NOTE',
  'SYSTEM_EVENT'
);

CREATE TABLE "visa_support_tickets" (
  "id"                    TEXT NOT NULL,
  "clientId"              TEXT NOT NULL,
  "caseId"                TEXT NOT NULL,
  "assignedStaffId"       TEXT,
  "department"            "VisaTicketDepartment" NOT NULL,
  "subjectEncrypted"      BYTEA NOT NULL,
  "status"                "VisaTicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority"              "VisaTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "lastClientMessageAt"   TIMESTAMP(3),
  "lastStaffMessageAt"    TIMESTAMP(3),
  "resolvedAt"            TIMESTAMP(3),
  "closedAt"              TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_support_tickets_clientId_status_idx"
  ON "visa_support_tickets"("clientId", "status");
CREATE INDEX "visa_support_tickets_assignedStaffId_status_idx"
  ON "visa_support_tickets"("assignedStaffId", "status");
CREATE INDEX "visa_support_tickets_caseId_idx"
  ON "visa_support_tickets"("caseId");

ALTER TABLE "visa_support_tickets"
  ADD CONSTRAINT "visa_support_tickets_clientId_fkey"
  FOREIGN KEY ("clientId")
  REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_support_tickets"
  ADD CONSTRAINT "visa_support_tickets_assignedStaffId_fkey"
  FOREIGN KEY ("assignedStaffId")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "visa_support_tickets"
  ADD CONSTRAINT "visa_support_tickets_caseId_fkey"
  FOREIGN KEY ("caseId")
  REFERENCES "visa_cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visa_support_ticket_messages" (
  "id"              TEXT NOT NULL,
  "ticketId"        TEXT NOT NULL,
  "authorId"        TEXT NOT NULL,
  "authorRole"      "VisaTicketMessageAuthorRole" NOT NULL,
  "bodyEncrypted"   BYTEA NOT NULL,
  "isInternalNote"  BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visa_support_ticket_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_support_ticket_messages_ticketId_createdAt_idx"
  ON "visa_support_ticket_messages"("ticketId", "createdAt");

ALTER TABLE "visa_support_ticket_messages"
  ADD CONSTRAINT "visa_support_ticket_messages_ticketId_fkey"
  FOREIGN KEY ("ticketId")
  REFERENCES "visa_support_tickets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_support_ticket_messages"
  ADD CONSTRAINT "visa_support_ticket_messages_authorId_fkey"
  FOREIGN KEY ("authorId")
  REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "visa_case_file_notes" (
  "id"                TEXT NOT NULL,
  "caseId"            TEXT NOT NULL,
  "noteType"          "VisaCaseFileNoteType" NOT NULL,
  "referenceId"       TEXT NOT NULL,
  "summaryEncrypted"  BYTEA NOT NULL,
  "createdById"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visa_case_file_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_case_file_notes_caseId_createdAt_idx"
  ON "visa_case_file_notes"("caseId", "createdAt");
CREATE INDEX "visa_case_file_notes_referenceId_idx"
  ON "visa_case_file_notes"("referenceId");

ALTER TABLE "visa_case_file_notes"
  ADD CONSTRAINT "visa_case_file_notes_caseId_fkey"
  FOREIGN KEY ("caseId")
  REFERENCES "visa_cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_case_file_notes"
  ADD CONSTRAINT "visa_case_file_notes_createdById_fkey"
  FOREIGN KEY ("createdById")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
