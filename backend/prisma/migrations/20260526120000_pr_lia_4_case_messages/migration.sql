-- PR-LIA-4 — Direct LIA ↔ client messaging on CRM Cases.
--
-- One row per message. `kind` discriminates between free-form MESSAGE,
-- an LIA-authored DOCUMENT_REQUEST (which the client can fulfil by
-- linking an existing VisaSupportingDocument), and an LIA-authored
-- PROGRESS_UPDATE (full-width status broadcast).
--
-- Both `bodyEncrypted` and the optional `requestedDocType` ride on
-- the same row; the shape variant is determined by `kind`.
--
-- Read-tracking is per-thread per-viewer (readByLia / readByClient),
-- not per-message — matches the spec.

-- 1. Two new enums.
CREATE TYPE "CaseMessageAuthorRole" AS ENUM (
  'LIA',
  'CLIENT'
);

CREATE TYPE "CaseMessageKind" AS ENUM (
  'MESSAGE',
  'DOCUMENT_REQUEST',
  'PROGRESS_UPDATE'
);

-- 2. case_messages table.
CREATE TABLE "case_messages" (
  "id"                 TEXT                       NOT NULL,
  "caseId"             TEXT                       NOT NULL,
  "authorId"           TEXT                       NOT NULL,
  "authorRole"         "CaseMessageAuthorRole"    NOT NULL,
  "kind"               "CaseMessageKind"          NOT NULL DEFAULT 'MESSAGE',
  "bodyEncrypted"      BYTEA                      NOT NULL,
  "requestedDocType"   TEXT,
  "fulfilledByFileId"  TEXT,
  "fulfilledAt"        TIMESTAMP(3),
  "readByClient"       BOOLEAN                    NOT NULL DEFAULT false,
  "readByLia"          BOOLEAN                    NOT NULL DEFAULT false,
  "createdAt"          TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_messages_pkey" PRIMARY KEY ("id")
);

-- 3. Indexes — timeline + per-viewer unread filter.
CREATE INDEX "case_messages_caseId_createdAt_idx"
  ON "case_messages"("caseId", "createdAt");

CREATE INDEX "case_messages_caseId_readByClient_idx"
  ON "case_messages"("caseId", "readByClient");

CREATE INDEX "case_messages_caseId_readByLia_idx"
  ON "case_messages"("caseId", "readByLia");

-- 4. FKs.
--    caseId ON DELETE CASCADE — case removal wipes its message thread.
--    authorId ON DELETE NO ACTION — message authorship survives a
--      User hard-delete; the PR-CONSULT-4 snapshot pattern in
--      audit_logs handles attribution post-deletion.
--    fulfilledByFileId ON DELETE SET NULL — if the supporting
--      document is removed, the message keeps its history but the
--      file link becomes null.
ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_fulfilledByFileId_fkey"
  FOREIGN KEY ("fulfilledByFileId") REFERENCES "visa_supporting_documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
