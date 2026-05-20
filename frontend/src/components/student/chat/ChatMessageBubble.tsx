'use client';

import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-4 — One chat bubble.
//
// User → right-aligned, soft gold tint. Assistant → left-aligned,
// off-white with a navy border. The content renders as plain text
// with `whitespace-pre-wrap`: the repo doesn't ship a markdown
// renderer and adding `react-markdown` for the v1 chat is more
// surface than it's worth — Claude's prose reads fine line-broken.
// Markdown rendering can ship as a tiny follow-up if needed.

export function ChatMessageBubble({
  role,
  content,
  createdAt,
}: {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  createdAt: string;
}) {
  if (role === 'SYSTEM') {
    return (
      <div className="flex justify-center py-2">
        <p className="text-xs italic text-slate-500">{content}</p>
      </div>
    );
  }
  const isUser = role === 'USER';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%] md:max-w-[75%]">
        <div className="px-1 pb-1 text-xs text-slate-500">
          {formatRelativeTime(createdAt)}
        </div>
        <div
          className={[
            'rounded-2xl px-4 py-3 text-sm leading-relaxed',
            isUser
              ? 'bg-sorena-gold/15 text-sorena-navy'
              : 'bg-[#faf8f3] text-sorena-navy border border-sorena-navy/10',
          ].join(' ')}
        >
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}
