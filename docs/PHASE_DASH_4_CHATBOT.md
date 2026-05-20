# PR-DASH-4 — Student AI Chatbot (Pattern 1 escalation)

Handover for the in-platform AI chatbot that landed on `main` as commit `1a67115`.

## 1. What this PR does

Students get an in-platform AI assistant at `/student/chat`, powered by Anthropic Claude Haiku. The assistant answers questions about navigating the Sorena platform, the student's own case status, meeting prep, document checklists, and generic NZ student-visa information. When the assistant detects a question it can't safely answer (low confidence, request for a human, case-specific judgement, etc.) it ends its reply with a sentinel token, which the backend strips before saving and flags as an offered escalation. The student then explicitly accepts or declines — accept creates a real `VisaSupportTicket` (PR-DASH-2) seeded with the last six chat messages plus optional extra context and links the ticket id back to the originating chat message; decline records an audit event and no ticket is created. The assistant never files documents, books meetings, or claims to have contacted INZ — the system prompt forbids it.

## 2. Files changed

Backend (new module `backend/src/students/chatbot/`):
- `chatbot.module.ts` — module wiring (imports Prisma, Crypto, Config, Tickets).
- `chatbot.controller.ts` — all six routes under `/api/student/chatbot/*`.
- `chatbot.service.ts` — owns ownership, encryption, Anthropic call, sentinel handling, ticket-seeding escalation.
- `anthropic.client.ts` — thin wrapper over `@anthropic-ai/sdk` with typed error envelopes.
- `system-prompt.ts` — `buildSystemPrompt(ctx)` factory and the `[[OFFER_ESCALATION]]` sentinel constant.
- `dto/send-message.dto.ts`, `dto/respond-to-escalation.dto.ts`, `dto/list-conversations.dto.ts`.
- `guards/chatbot-rate-limit.guards.ts` — three DB-count guards (create / message / escalate).

Backend (existing):
- `prisma/schema.prisma` — added `VisaChatConversation`, `VisaChatMessage`, `VisaChatMessageRole` enum; back-relations on `User` and `VisaSupportTicket`.
- `prisma/migrations/20260520222110_pr_dash_4_chatbot/migration.sql` — hand-written DDL.
- `src/students/students.module.ts` — registered `ChatbotModule`.
- `.env.example` — added `ANTHROPIC_API_KEY` and `ANTHROPIC_CHATBOT_MODEL` placeholders.

Frontend (new):
- `src/app/student/chat/page.tsx` — server-component auth shell.
- `src/components/student/chat/` — `ChatLayout`, `ConversationList`, `ChatThread`, `ChatMessageBubble`, `ChatInput`, `EscalationOfferCard`, `EscalationLinkedBadge`, `ChatbotCard` (8 components).

Frontend (existing):
- `src/app/student/dashboard/page.tsx` — swapped the "Ask Sorena — coming soon" placeholder for `ChatbotCard`.
- `src/components/dashboard/PlaceholderCards.tsx` — deleted (no remaining placeholders after PR-DASH-2/3/4).
- `src/i18n/messages/{en,fa}.json` — 17 new keys under `chat.*`.

## 3. Schema added

```prisma
enum VisaChatMessageRole { USER ASSISTANT SYSTEM }

model VisaChatConversation {
  id, studentId, title?,                 // title encrypted (TEXT base64)
  createdAt, updatedAt, archivedAt?
  @@index([studentId, updatedAt])
}

model VisaChatMessage {
  id, conversationId, role,
  content,                               // encrypted (TEXT base64)
  tokensIn?, tokensOut?, modelUsed?,
  escalationOffered (default false),
  escalatedTicketId?,                    // FK → VisaSupportTicket, SET NULL on ticket delete
  createdAt
  @@index([conversationId, createdAt])
}
```

FK rules: `student → conversation` is `NO ACTION` (preserves chat history if a User is removed administratively); `conversation → message` cascades; `escalation message → ticket` is `SET NULL` (deleting a ticket keeps the chat row intact so the audit trail of the escalation event is preserved).

Encryption: `title` and `content` are stored as base64-encoded AES-256-GCM ciphertext in TEXT columns (`enc()` / `dec()` in the service wrap CryptoService). Cleartext lives in memory only long enough to send to / receive from Anthropic, never logged.

## 4. Environment variables

- **`ANTHROPIC_API_KEY`** (backend) — required. If missing in development, chatbot endpoints return 503; in production the app fails to boot at module init (`AnthropicClient.onModuleInit`).
- **`ANTHROPIC_CHATBOT_MODEL`** (backend, optional) — defaults to `claude-haiku-4-5-20251001`. Override for staging if needed.

No new frontend env vars. The chatbot calls live behind authenticated `/api/student/chatbot/*` routes; no model id or key ever lands in the client bundle.

## 5. Services + endpoints

All under `JwtAuthGuard + RolesGuard`, `@Roles('STUDENT')`. All routes filter by `studentId = req.user.userId`; not-owned responses are 404 (not 403) to avoid existence leaks.

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/student/chatbot/conversations` | List own conversations, paginated. |
| `POST` | `/api/student/chatbot/conversations` | Create empty conversation. |
| `GET`  | `/api/student/chatbot/conversations/:id` | Full conversation + messages (decrypted). |
| `POST` | `/api/student/chatbot/conversations/:id/messages` | Send a user message; backend calls Anthropic, persists both messages. |
| `POST` | `/api/student/chatbot/conversations/:id/messages/:messageId/escalate` | Accept or decline the escalation offer. Accept builds a ticket via `TicketsService.createTicket()`. |
| `POST` | `/api/student/chatbot/conversations/:id/archive` | Soft-archive a conversation. |

**Anthropic call:** last 12 messages of the thread go in as context (chronological), the system prompt is built per-request from a small student snapshot — `firstName`, `locale` (en/fa), per-status meeting counts, and `VisaCase.status`. Max output 800 tokens. Token counts + `modelUsed` are stored on the persisted assistant row for future audit.

**Sentinel handling:** if the model emits `[[OFFER_ESCALATION]]` on its own line, the service strips the token (and any line of pure-token / surrounding blanks), flips `escalationOffered=true`, and writes a `CHAT_ESCALATION_OFFERED` audit row. If the stripped reply is empty, a short fallback is substituted so the UI never renders an empty bubble.

**Ticket seeding (on accept):** subject = first 80 chars of conversation title or replay; body = role-labelled replay of the last 6 messages + optional `additionalContext` + trailer `(Created from in-platform chatbot escalation)`. Calls `TicketsService.createTicket()` so the ticket inherits the PR-DASH-2 rate limit, file-note creation, encryption, and audit-log emission.

**Audit eventTypes emitted:** `CHAT_CONVERSATION_CREATED`, `CHAT_MESSAGE_SENT`, `CHAT_ESCALATION_OFFERED`, `CHAT_ESCALATION_ACCEPTED` (carries `ticketId` in `newValue`), `CHAT_ESCALATION_DECLINED`, `CHAT_CONVERSATION_ARCHIVED`.

## 6. How to test (manual)

1. **Migration applied:** `cd backend && npx prisma migrate status` — should show `20260520222110_pr_dash_4_chatbot` applied.
2. **Backend builds:** `cd backend && npx tsc --noEmit` — exits clean.
3. **Frontend builds:** `cd frontend && npx tsc --noEmit` — exits clean.
4. **Env set:** put a real `ANTHROPIC_API_KEY` in `backend/.env`, restart backend.
5. **First conversation:** log in as a STUDENT, click the "Assistant" card on the dashboard or visit `/student/chat`. Click "New conversation". Send a benign question like "What does case status DRAFT mean?". Expect a short, friendly reply.
6. **Title capture:** refresh the conversation list — the conversation should be titled with the first 80 chars of your question.
7. **Escalation offer:** ask "Should I appeal a declined visa?". Expect a short reply that DOES NOT contain `[[OFFER_ESCALATION]]` (the service strips it) followed by an "Want me to escalate this…" card with two buttons.
8. **Decline:** click "No thanks". The card vanishes. Check `audit_logs` for a `CHAT_ESCALATION_DECLINED` row.
9. **Accept (separate question):** trigger another escalation, fill the "additional context" box, click "Create support ticket". Expect a green success state with a "Linked to ticket #..." link. Click through to `/student/tickets/{id}` and confirm the ticket exists with the replay in the first message.
10. **Ownership:** try `GET /api/student/chatbot/conversations/{other-student-conv-id}` with your STUDENT token — expect 404.
11. **Rate limit:** post 30 messages in 10 minutes — the 31st returns 429 with `{ error: 'CHATBOT_RATE_LIMITED' }`. The frontend surfaces the rate-limit toast.
12. **Anthropic outage:** stub the key as `bad` and send a message — backend persists the user message but returns 503; frontend rolls back the optimistic bubble and shows the unavailable toast.

## 7. Known limitations

- **No streaming.** Replies are non-streamed `messages.create` calls. The student sees a "Thinking…" indicator until the full reply arrives. Adding SSE / stream rendering is a straightforward follow-up.
- **No markdown rendering.** Assistant messages render as plain text with `whitespace-pre-wrap`. Markdown is added later if needed; the spec gave us permission to skip `react-markdown` if it'd be the only dep needed for it.
- **No reopening of escalations.** A single escalation offer per assistant message; once `escalatedTicketId` is set or the offer is declined the card is gone. To escalate again the student sends a new message and the model may offer again.
- **Department hard-coded to `GENERAL_INQUIRY`.** All escalation tickets land in the general inbox. A future PR could have the model suggest a department and the service map it.
- **No "regenerate" or "edit my last message".** v1 keeps the thread immutable.
- **No model-side tool use.** The chatbot doesn't call platform APIs; it only reads from the static prompt context. Letting it look up meeting details or document statuses directly would need a tool-use layer.
- **No staff-side chatbot.** Per spec, this PR is student-only. Staff already have the support-ticket inbox for the human side.

## 8. How to extend

- **Streaming replies.** Swap `messages.create` for `messages.stream` in `AnthropicClient`, push chunks over SSE to the frontend, accumulate on the client. The persisted row stays a single record — we only stream the cosmetic appearance.
- **Markdown rendering.** Add `react-markdown` to `frontend/package.json` and swap the `<p whitespace-pre-wrap>` in `ChatMessageBubble` for the renderer. About 30 minutes of work.
- **Tool use.** Add an `anthropic.tools` array describing read-only operations (`get_visa_step`, `list_upcoming_meetings`, `get_ticket_status`), implement the handlers in the service, and the assistant can answer "what's my next meeting?" without the prompt-stuffed context.
- **Smarter department routing.** Have the model emit a token like `[[DEPT:DOCUMENTS]]` alongside the escalation sentinel; map it in the service to the right `VisaTicketDepartment`.
- **Conversation summarisation.** When a thread exceeds N messages, run a separate Claude call to produce a 200-word summary, store it on a new column, and use it as the prefix instead of the last 12 messages.
- **Quality-of-life:** add "Regenerate reply" and "Edit last message" (re-runs from that point), conversation search, message-level reactions for QA feedback.

## 9. Security layers applied

- **Layer 1 — auth:** JwtAuthGuard + RolesGuard on every route. STUDENT-only.
- **Layer 2 — RLS / ownership:** every query filters by `studentId = req.user.userId`. 404 on not-owned to avoid existence leaks.
- **Layer 3 — input validation:** class-validator on every DTO. Message length capped at 4000 chars. Additional-context capped at 2000. Locale restricted to `en | fa`.
- **Layer 4 — encryption at rest:** AES-256-GCM via existing CryptoService on `VisaChatConversation.title` and `VisaChatMessage.content`. Cleartext lives only in memory.
- **Layer 5 — rate limiting:** per-user DB-count guards (same pattern as PR-DASH-2/3) — 10 conversations/hour, 30 messages / 10 min, 5 escalate decisions/hour.
- **Layer 6 — audit log:** six structured `eventType` values written on every mutation; the dashboard activity feed will pick them up automatically.
- **Layer 7 — secrets handling:** `ANTHROPIC_API_KEY` is backend-only. No `NEXT_PUBLIC_*` exposes it. The model id is also backend-only — clients only see the chat payload.
- **Layer 8 — prompt safety:** the system prompt forbids legal advice, fabricated policy numbers, impersonating consultants, and revealing itself. It also defines the escalation sentinel contract explicitly, so the model has a documented "I don't know — get a human" affordance.
- **Layer 9 — PII minimisation in context:** only `firstName`, `locale`, meeting counts, and `caseStage` go into the system prompt. No document content, passport numbers, addresses, or other PII.
- **Layer 10 — error logging hygiene:** `AnthropicClient` logs the Anthropic error class + message but never the prompt body. The service logs upstream errors with a "(no PII)" marker and the cause string only.

## 10. Rollback procedure

```bash
# 1. revert the feature commit
git revert 1a67115

# 2. drop tables + enum (run as the DB owner)
psql -d sorena_visa <<SQL
DROP TABLE IF EXISTS visa_chat_messages CASCADE;
DROP TABLE IF EXISTS visa_chat_conversations CASCADE;
DROP TYPE  IF EXISTS "VisaChatMessageRole";
DELETE FROM _prisma_migrations WHERE migration_name = '20260520222110_pr_dash_4_chatbot';
SQL

# 3. push the revert
git push origin main
```

The DB backup taken before the migration applied lives at `backend/backup_before_pr_dash_4.sql` (gitignored). Restore from it if anything goes sideways during rollback.
