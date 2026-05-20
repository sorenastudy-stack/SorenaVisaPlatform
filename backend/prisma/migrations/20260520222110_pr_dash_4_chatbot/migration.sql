-- PR-DASH-4 — In-platform AI chatbot (student-side).
--
-- Two tables + one enum. Conversation titles + every message body
-- are stored as base64-encoded AES-256-GCM ciphertext in TEXT
-- columns (CryptoService at the boundary) — same convention as
-- PR-DASH-3's encrypted text columns.
--
-- FK rules:
--   * student → conversation: NO ACTION (a deleted user blocks
--     deletion; we don't want to silently lose conversation history).
--   * conversation → message: CASCADE (archive-by-deletion).
--   * escalation message → ticket: SET NULL (a deleted ticket
--     drops the back-link but leaves the chat message intact, so
--     the audit trail of the escalation is preserved).
--
-- Audit events emitted by chatbot.service:
--   CHAT_CONVERSATION_CREATED, CHAT_MESSAGE_SENT,
--   CHAT_ESCALATION_OFFERED, CHAT_ESCALATION_ACCEPTED (writes ticket
--   id in newValue), CHAT_ESCALATION_DECLINED,
--   CHAT_CONVERSATION_ARCHIVED.
--
-- Hand-written, applied via `prisma migrate deploy` — project
-- convention (every prior PR uses hand-written migrations).

CREATE TYPE "VisaChatMessageRole" AS ENUM (
  'USER',
  'ASSISTANT',
  'SYSTEM'
);

CREATE TABLE "visa_chat_conversations" (
  "id"         TEXT NOT NULL,
  "studentId"  TEXT NOT NULL,
  "title"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "visa_chat_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_chat_conversations_studentId_updatedAt_idx"
  ON "visa_chat_conversations"("studentId", "updatedAt");

ALTER TABLE "visa_chat_conversations"
  ADD CONSTRAINT "visa_chat_conversations_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "visa_chat_messages" (
  "id"                TEXT NOT NULL,
  "conversationId"    TEXT NOT NULL,
  "role"              "VisaChatMessageRole" NOT NULL,
  "content"           TEXT NOT NULL,
  "tokensIn"          INTEGER,
  "tokensOut"         INTEGER,
  "modelUsed"         TEXT,
  "escalationOffered" BOOLEAN NOT NULL DEFAULT FALSE,
  "escalatedTicketId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visa_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visa_chat_messages_conversationId_createdAt_idx"
  ON "visa_chat_messages"("conversationId", "createdAt");

ALTER TABLE "visa_chat_messages"
  ADD CONSTRAINT "visa_chat_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "visa_chat_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visa_chat_messages"
  ADD CONSTRAINT "visa_chat_messages_escalatedTicketId_fkey"
  FOREIGN KEY ("escalatedTicketId") REFERENCES "visa_support_tickets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
