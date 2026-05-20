'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ChatMessageBubble } from './ChatMessageBubble';
import { EscalationOfferCard } from './EscalationOfferCard';
import { EscalationLinkedBadge } from './EscalationLinkedBadge';

// PR-DASH-4 — Scrollable message list.
//
// Each USER / ASSISTANT message renders as a bubble. After an
// assistant message with `escalationOffered=true`:
//   * if it already has `escalatedTicketId` → render the linked
//     badge (the student accepted earlier);
//   * otherwise → render the offer card so the student can decide.
//
// Autoscroll to the bottom whenever the message list grows. Empty
// state copy lives in i18n and is shown when no messages exist yet.

export interface ChatMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  escalationOffered?: boolean;
  escalatedTicketId?: string | null;
  createdAt: string;
}

export function ChatThread({
  conversationId,
  messages,
  onEscalationAccepted,
}: {
  conversationId: string;
  messages: ChatMessage[];
  onEscalationAccepted: (ticketId: string) => void;
}) {
  const t = useTranslations();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-sorena-navy">
          {t('chat.empty.title')}
        </h2>
        <p className="mt-2 max-w-md text-sm text-slate-600">
          {t('chat.empty.subtitle')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4 md:px-6 md:py-6">
      {messages.map((m) => (
        <div key={m.id} className="flex flex-col">
          <ChatMessageBubble
            role={m.role}
            content={m.content}
            createdAt={m.createdAt}
          />
          {m.role === 'ASSISTANT' &&
            m.escalationOffered &&
            !m.escalatedTicketId && (
              <div className="ms-2 mt-1 max-w-[85%] md:max-w-[75%]">
                <EscalationOfferCard
                  conversationId={conversationId}
                  messageId={m.id}
                  onAccepted={onEscalationAccepted}
                />
              </div>
            )}
          {m.role === 'ASSISTANT' && m.escalatedTicketId && (
            <div className="ms-2 max-w-[85%] md:max-w-[75%]">
              <EscalationLinkedBadge ticketId={m.escalatedTicketId} />
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
