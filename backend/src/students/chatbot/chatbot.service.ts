import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AnthropicClient } from './anthropic.client';
import { TicketsService } from '../tickets/tickets.service';
import { buildSystemPrompt, ESCALATION_TOKEN_VALUE } from './system-prompt';

// PR-DASH-4 — Chatbot service.
//
// Five responsibilities:
//   1. Conversation + message CRUD with per-user ownership checks
//      (404 on not-owned to avoid existence leaks — same pattern as
//      PR-DASH-2 / PR-DASH-3).
//   2. Encrypt / decrypt PII at the boundary. Conversation titles
//      and every message body are AES-256-GCM via CryptoService;
//      cleartext lives only in memory and only as long as it takes
//      to ship to / receive from Anthropic.
//   3. Drive Anthropic Haiku via AnthropicClient. The last 12
//      messages of the thread are passed as context; the system
//      prompt is built fresh per request from a small read-only
//      student snapshot (first name, locale, meeting counts, case
//      stage) — no document content, no passport numbers.
//   4. Detect the `[[OFFER_ESCALATION]]` sentinel in the model's
//      reply, strip it cleanly, and flag the message for escalation
//      UX.
//   5. On accepted escalation, build a real VisaSupportTicket via
//      the PR-DASH-2 service and link the ticket id back to the
//      originating assistant message.

const CONTEXT_WINDOW = 12;
const MAX_OUTPUT_TOKENS = 800;
const TITLE_MAX = 80;
const LAST_N_FOR_ESCALATION = 6;

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly anthropic: AnthropicClient,
    private readonly tickets: TicketsService,
  ) {}

  // ── Crypto helpers (base64-string envelope, matches PR-DASH-3 pattern) ─

  private enc(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    return this.crypto.encrypt(plain).toString('base64');
  }

  private dec(stored: string | null | undefined): string {
    if (!stored) return '';
    try {
      return this.crypto.decrypt(Buffer.from(stored, 'base64'));
    } catch {
      // Don't crash a whole thread if one row is corrupt.
      return '';
    }
  }

  // ── Audit-emit helper ─────────────────────────────────────────────

  private async writeAudit(
    userId: string,
    eventType: string,
    entityId: string,
    extras: { newValue?: unknown; oldValue?: unknown } = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action:     eventType,
        eventType,
        entityType: 'VisaChat',
        entityId,
        oldValue:   (extras.oldValue ?? null) as never,
        newValue:   (extras.newValue ?? null) as never,
      },
    });
  }

  // ── Ownership ──────────────────────────────────────────────────────

  // Loads a conversation and confirms the caller owns it. 404 (not
  // 403) on miss — never reveal that an id exists but isn't theirs.
  private async ownedConversation(userId: string, conversationId: string) {
    const c = await this.prisma.visaChatConversation.findFirst({
      where: { id: conversationId, studentId: userId },
    });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  // ── Conversation routes ───────────────────────────────────────────

  async listConversations(userId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, Math.floor(page));
    const safeSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
    const rows = await this.prisma.visaChatConversation.findMany({
      where:   { studentId: userId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      skip:    (safePage - 1) * safeSize,
      take:    safeSize,
      include: {
        // Last message preview — needs the most recent row only.
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    return rows.map((r) => {
      const last = r.messages[0];
      const preview = last ? this.dec(last.content).slice(0, 80) : '';
      return {
        id:        r.id,
        title:     this.dec(r.title) || null,
        updatedAt: r.updatedAt,
        preview,
      };
    });
  }

  async createConversation(userId: string) {
    const c = await this.prisma.visaChatConversation.create({
      data: { studentId: userId },
    });
    await this.writeAudit(userId, 'CHAT_CONVERSATION_CREATED', c.id);
    return { id: c.id };
  }

  async getConversation(userId: string, conversationId: string) {
    const c = await this.ownedConversation(userId, conversationId);
    const messages = await this.prisma.visaChatMessage.findMany({
      where:   { conversationId: c.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id:         c.id,
      title:      this.dec(c.title) || null,
      createdAt:  c.createdAt,
      updatedAt:  c.updatedAt,
      archivedAt: c.archivedAt,
      messages: messages.map((m) => ({
        id:                m.id,
        role:              m.role,
        content:           this.dec(m.content),
        escalationOffered: m.escalationOffered,
        escalatedTicketId: m.escalatedTicketId,
        createdAt:         m.createdAt,
        modelUsed:         m.modelUsed,
      })),
    };
  }

  async archiveConversation(userId: string, conversationId: string) {
    const c = await this.ownedConversation(userId, conversationId);
    if (c.archivedAt) return { id: c.id, archivedAt: c.archivedAt }; // idempotent
    const archived = await this.prisma.visaChatConversation.update({
      where: { id: c.id },
      data:  { archivedAt: new Date() },
    });
    await this.writeAudit(userId, 'CHAT_CONVERSATION_ARCHIVED', c.id);
    return { id: archived.id, archivedAt: archived.archivedAt };
  }

  // ── Student-context snapshot for the system prompt ────────────────

  // Tiny read — User row + the VisaCase status + meeting counts.
  // Deliberately minimal so we never accidentally inject document
  // content or passport numbers into the prompt.
  private async buildStudentContext(
    userId: string,
    locale: 'en' | 'fa',
  ) {
    const [user, visaCase, meetings] = await Promise.all([
      this.prisma.user.findUnique({
        where:  { id: userId },
        select: { name: true },
      }),
      this.prisma.visaCase.findFirst({
        where:  { clientId: userId },
        select: { status: true },
      }),
      this.prisma.visaMeeting.groupBy({
        by:      ['status'],
        where:   { studentId: userId },
        _count:  { _all: true },
      }),
    ]);
    const firstName = (user?.name ?? '').trim().split(/\s+/)[0] || '';
    const meetingCounts: Record<string, number> = {};
    for (const row of meetings) {
      meetingCounts[row.status] = row._count._all;
    }
    return {
      firstName,
      locale,
      meetingCounts,
      caseStage: visaCase?.status ?? null,
    };
  }

  // ── The big one: send a message ───────────────────────────────────

  async sendMessage(
    userId: string,
    conversationId: string,
    content: string,
    locale: 'en' | 'fa' = 'en',
  ) {
    const conversation = await this.ownedConversation(userId, conversationId);

    const trimmed = content.trim();
    if (trimmed === '') {
      throw new BadRequestException('Message cannot be empty');
    }

    // 1. Persist the user message FIRST so a downstream Anthropic
    //    failure doesn't lose it.
    const userMsg = await this.prisma.visaChatMessage.create({
      data: {
        conversationId: conversation.id,
        role:           'USER',
        content:        this.enc(trimmed)!,
      },
    });
    await this.writeAudit(userId, 'CHAT_MESSAGE_SENT', conversation.id);

    // 2. If this is the conversation's first message, capture a
    //    truncated title from it.
    if (!conversation.title) {
      const title = trimmed.slice(0, TITLE_MAX);
      await this.prisma.visaChatConversation.update({
        where: { id: conversation.id },
        data:  { title: this.enc(title) },
      });
    }

    // 3. Build the system prompt + the trailing CONTEXT_WINDOW
    //    messages (including the one we just stored).
    const ctx = await this.buildStudentContext(userId, locale);
    const system = buildSystemPrompt(ctx);

    const history = await this.prisma.visaChatMessage.findMany({
      where:   { conversationId: conversation.id, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take:    CONTEXT_WINDOW,
    });
    // Decrypt + reverse (we fetched DESC for the LIMIT, the API
    // wants chronological ASC).
    const messages = history
      .reverse()
      .map((m) => ({
        role:    m.role === 'ASSISTANT' ? 'assistant' as const : 'user' as const,
        content: this.dec(m.content),
      }));

    // 4. Call Anthropic.
    const call = await this.anthropic.createMessage({
      system,
      messages,
      maxTokens: MAX_OUTPUT_TOKENS,
    });

    if (call.ok !== true) {
      // Per spec: 503 for unavailable, 429 for rate limit, generic
      // 500 otherwise. The user message stays persisted; the
      // assistant message is NOT. Local-binding `err` here so TS
      // narrows cleanly even when the union is widened by inference
      // somewhere upstream.
      const err = call.error;
      if (err.kind === 'UNAVAILABLE') {
        throw new HttpException(
          { statusCode: HttpStatus.SERVICE_UNAVAILABLE, error: 'CHATBOT_UNAVAILABLE' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (err.kind === 'RATE_LIMITED') {
        throw new HttpException(
          { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'CHATBOT_RATE_LIMITED' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      this.logger.error(`[chatbot] sendMessage upstream error (no PII): ${String(err.cause)}`);
      throw new HttpException({ statusCode: 500, error: 'CHATBOT_ERROR' }, 500);
    }

    // 5. Detect + strip the escalation sentinel.
    let rawText = call.result.text ?? '';
    let escalationOffered = false;
    if (rawText.includes(ESCALATION_TOKEN_VALUE)) {
      escalationOffered = true;
      // Strip the literal token AND any leading/trailing whitespace
      // / blank lines it leaves behind.
      rawText = rawText
        .split('\n')
        .filter((line) => line.trim() !== ESCALATION_TOKEN_VALUE)
        .join('\n')
        .replace(new RegExp(this.escapeRegex(ESCALATION_TOKEN_VALUE), 'g'), '')
        .trim();
    }
    if (rawText.trim() === '') {
      // Fallback if the model emitted ONLY the token. Surface a
      // bland but honest line so the user doesn't see an empty
      // bubble.
      rawText = 'I want to make sure you get the right answer here. Can a Sorena consultant help?';
    }

    // 6. Persist the assistant message.
    const assistantMsg = await this.prisma.visaChatMessage.create({
      data: {
        conversationId:    conversation.id,
        role:              'ASSISTANT',
        content:           this.enc(rawText)!,
        tokensIn:          call.result.inputTokens,
        tokensOut:         call.result.outputTokens,
        modelUsed:         call.result.modelUsed,
        escalationOffered,
      },
    });
    // Bump the conversation's updatedAt so the list view sorts it
    // to the top.
    await this.prisma.visaChatConversation.update({
      where: { id: conversation.id },
      data:  { updatedAt: new Date() },
    });

    if (escalationOffered) {
      await this.writeAudit(userId, 'CHAT_ESCALATION_OFFERED', assistantMsg.id);
    }

    return {
      userMessage: {
        id:        userMsg.id,
        role:      'USER' as const,
        content:   trimmed,
        createdAt: userMsg.createdAt,
      },
      assistantMessage: {
        id:                assistantMsg.id,
        role:              'ASSISTANT' as const,
        content:           rawText,
        escalationOffered,
        escalatedTicketId: null,
        modelUsed:         call.result.modelUsed,
        createdAt:         assistantMsg.createdAt,
      },
    };
  }

  // Escape sentinel for use inside a RegExp.
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── Escalation accept / decline ───────────────────────────────────

  async respondToEscalation(
    userId: string,
    conversationId: string,
    messageId: string,
    accept: boolean,
    additionalContext?: string,
  ) {
    const conversation = await this.ownedConversation(userId, conversationId);

    const message = await this.prisma.visaChatMessage.findFirst({
      where: { id: messageId, conversationId: conversation.id, role: 'ASSISTANT' },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (!message.escalationOffered) {
      throw new BadRequestException('Escalation was not offered on this message');
    }
    if (message.escalatedTicketId) {
      // Already accepted earlier — return the linked message
      // idempotently rather than 4xx.
      return {
        id:                message.id,
        escalationOffered: true,
        escalatedTicketId: message.escalatedTicketId,
      };
    }

    if (!accept) {
      await this.writeAudit(userId, 'CHAT_ESCALATION_DECLINED', message.id);
      return {
        id:                message.id,
        escalationOffered: true,
        escalatedTicketId: null,
      };
    }

    // Accept path: build a ticket via the PR-DASH-2 service. We
    // hand it the raw fields; it handles encryption + audit +
    // its own rate-limit + file note creation internally.
    const lastN = await this.prisma.visaChatMessage.findMany({
      where:   { conversationId: conversation.id, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take:    LAST_N_FOR_ESCALATION,
    });
    const replay = lastN
      .reverse()
      .map((m) => `${m.role === 'USER' ? 'Student' : 'Assistant'}: ${this.dec(m.content)}`)
      .join('\n\n');
    const titleSrc = this.dec(conversation.title) || replay.split('\n')[0] || 'Help from a consultant';
    const subject = titleSrc.slice(0, TITLE_MAX);

    const extraBlock = (additionalContext ?? '').trim();
    const initialMessage = [
      replay,
      extraBlock ? `Additional context from the student:\n${extraBlock}` : null,
      '(Created from in-platform chatbot escalation)',
    ].filter(Boolean).join('\n\n');

    // GENERAL_INQUIRY is the broadest department — a consultant
    // will route it correctly on the staff inbox side.
    const ticket = await this.tickets.createTicket(userId, {
      department:     'GENERAL_INQUIRY',
      subject,
      initialMessage,
    });

    // Link the new ticket id back onto the assistant message so the
    // chat UI can render a "Linked to ticket #..." badge.
    await this.prisma.visaChatMessage.update({
      where: { id: message.id },
      data:  { escalatedTicketId: ticket.id },
    });

    await this.writeAudit(userId, 'CHAT_ESCALATION_ACCEPTED', message.id, {
      newValue: { ticketId: ticket.id },
    });

    return {
      id:                message.id,
      escalationOffered: true,
      escalatedTicketId: ticket.id,
    };
  }
}
