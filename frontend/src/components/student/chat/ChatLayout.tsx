'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ConversationList, type ConversationRow } from './ConversationList';
import { ChatThread, type ChatMessage } from './ChatThread';
import { ChatInput } from './ChatInput';

// PR-DASH-4 — Responsive shell for the chatbot.
//
// Mobile: single column. Conversation list collapses to a top
// strip; the active thread fills the rest.
// Desktop (`md:` and up): two-pane — sidebar list + main thread.
//
// State is owned here:
//   * conversations  — the list rail rows.
//   * activeId       — which conversation is open.
//   * messages       — the active conversation's messages.
//   * busy           — set while we await an assistant reply; drives
//                       both the input's disabled state and the
//                       "Thinking…" indicator.
//
// We route every backend call through `api.*` (cookie-bound auth).
// 503/429 are mapped to friendly toasts; any other 4xx/5xx surfaces
// the raw message so the student isn't left guessing.

export function ChatLayout() {
  const t = useTranslations();
  const locale = useLocale();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  // Load the conversation list on mount. If the student has any
  // active conversation, select the most recent automatically.
  useEffect(() => {
    let cancelled = false;
    api
      .get<ConversationRow[]>('/api/student/chatbot/conversations')
      .then((rows) => {
        if (cancelled) return;
        setConversations(rows);
        if (rows.length > 0) setActiveId(rows[0]!.id);
      })
      .catch(() => { /* leave empty */ })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, []);

  // Whenever the active conversation changes, load its messages.
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    api
      .get<{ messages: ChatMessage[] }>(`/api/student/chatbot/conversations/${activeId}`)
      .then((res) => { if (!cancelled) setMessages(res.messages ?? []); })
      .catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, [activeId]);

  const onNew = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.post<{ id: string }>('/api/student/chatbot/conversations', {});
      setConversations((prev) => [
        { id: res.id, title: null, preview: '', updatedAt: new Date().toISOString() },
        ...prev,
      ]);
      setActiveId(res.id);
      setMessages([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('CHATBOT_RATE_LIMITED')) {
        toast.error(t('chat.errors.rateLimited'));
      } else {
        toast.error(t('chat.errors.unavailable'));
      }
    } finally {
      setBusy(false);
    }
  }, [t]);

  const onSend = useCallback(async (content: string) => {
    if (!activeId) return;
    // Optimistic user bubble so the thread feels responsive.
    const optimisticUser: ChatMessage = {
      id:        `tmp-${Date.now()}`,
      role:      'USER',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setBusy(true);
    try {
      const res = await api.post<{
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
      }>(`/api/student/chatbot/conversations/${activeId}/messages`, {
        content,
        locale: locale === 'fa' ? 'fa' : 'en',
      });
      // Replace the optimistic message with the server one (so the
      // id is real) and append the assistant reply.
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimisticUser.id);
        return [...withoutOptimistic, res.userMessage, res.assistantMessage];
      });
      // Bump the conversation up in the list with a fresh updatedAt.
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === activeId);
        if (idx < 0) return prev;
        const updated = {
          ...prev[idx]!,
          updatedAt: res.assistantMessage.createdAt,
          preview:   res.assistantMessage.content.slice(0, 80),
          title:     prev[idx]!.title ?? content.slice(0, 80),
        };
        return [updated, ...prev.filter((c) => c.id !== activeId)];
      });
    } catch (err) {
      // Roll back the optimistic message on failure.
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('CHATBOT_RATE_LIMITED')) {
        toast.error(t('chat.errors.rateLimited'));
      } else {
        toast.error(t('chat.errors.unavailable'));
      }
    } finally {
      setBusy(false);
    }
  }, [activeId, locale, t]);

  const onEscalationAccepted = useCallback((ticketId: string) => {
    // Patch the last assistant message in the thread so the badge
    // swaps in immediately (the server has already persisted the
    // link; the optimistic update saves a round-trip).
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i]!;
        if (m.role === 'ASSISTANT' && m.escalationOffered && !m.escalatedTicketId) {
          next[i] = { ...m, escalatedTicketId: ticketId };
          break;
        }
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-0rem)] flex-col bg-[#faf8f3] md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:w-72 md:flex-none md:border-b-0 md:border-e">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => setActiveId(id)}
          onNew={onNew}
          busy={busy || loadingList}
        />
      </aside>
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          {activeId ? (
            <ChatThread
              conversationId={activeId}
              messages={messages}
              onEscalationAccepted={onEscalationAccepted}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-4 py-12 text-center">
              <h2 className="text-xl font-bold text-sorena-navy">
                {t('chat.empty.title')}
              </h2>
              <p className="mt-2 max-w-md text-sm text-slate-600">
                {t('chat.empty.subtitle')}
              </p>
            </div>
          )}
        </div>
        {activeId && <ChatInput busy={busy} onSend={onSend} />}
      </main>
    </div>
  );
}
