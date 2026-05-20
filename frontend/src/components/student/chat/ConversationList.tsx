'use client';

import { useTranslations } from 'next-intl';
import { Plus, MessageSquare } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-4 — Left-rail conversation list.
//
// On mobile this stack renders ABOVE the active chat panel (the
// ChatLayout collapses to one column). On desktop it sits in a
// fixed-width sidebar. "New conversation" is the only primary
// action — the conversation rows themselves are secondary.

export interface ConversationRow {
  id: string;
  title: string | null;
  preview: string;
  updatedAt: string;
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  busy,
}: {
  conversations: ConversationRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  busy: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="flex h-full flex-col gap-3 p-3 md:p-4">
      <button
        type="button"
        onClick={onNew}
        disabled={busy}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-sorena-navy px-4 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2"
      >
        <Plus size={16} />
        {t('chat.conversations.new')}
      </button>

      {conversations.length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-slate-500">
          {t('chat.conversations.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className={[
                  'flex w-full flex-col items-start gap-1 rounded-xl px-3 py-2 text-left transition-colors',
                  activeId === c.id
                    ? 'bg-sorena-navy/10 text-sorena-navy'
                    : 'text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                <div className="flex w-full items-center gap-2">
                  <MessageSquare size={14} className="flex-none text-slate-400" />
                  <p className="flex-1 truncate text-sm font-semibold">
                    {c.title ?? t('chat.empty.title')}
                  </p>
                </div>
                {c.preview && (
                  <p className="line-clamp-1 w-full text-xs text-slate-500">
                    {c.preview}
                  </p>
                )}
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  {formatRelativeTime(c.updatedAt)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
