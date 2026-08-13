'use client';

import * as React from 'react';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-4 — One chat bubble.
//
// User → right-aligned, soft gold tint. Assistant → left-aligned,
// off-white with a navy border.
//
// The assistant writes markdown whether or not we render it, so leaving the
// content as plain text meant clients read literal asterisks:
//   "Your case is currently in **DRAFT** stage"
// That is the follow-up the original note anticipated. Rather than pull in
// react-markdown for two constructs, `renderInlineMarkdown` handles the two
// the model actually emits — **bold** and `code` — and leaves everything else
// exactly as typed. Bullets and blank lines already survive via
// `whitespace-pre-wrap`.
//
// Deliberately NOT a general markdown renderer: no links, no raw HTML, nothing
// that turns model output into markup a client's browser will execute.

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
const BOLD = /^\*\*[^*\n]+\*\*$/;
const CODE = /^`[^`\n]+`$/;

/**
 * The same markers, removed rather than rendered.
 *
 * For a one-line clamped preview, bold is noise — but literal asterisks are
 * worse: the conversation list was showing clients
 * "Your case is currently in **DRAFT** stage".
 */
export function stripInlineMarkdown(text: string): string {
  return text.replace(INLINE, (m) => m.slice(m.startsWith('**') ? 2 : 1, m.startsWith('**') ? -2 : -1));
}

/** **bold** and `code` become elements; every other character is untouched. */
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (BOLD.test(part)) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (CODE.test(part)) {
      return (
        <code key={i} className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

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
              ? 'bg-[#c9a961]/15 text-sorena-navy'
              : 'bg-[#faf8f3] text-sorena-navy border border-sorena-navy/10',
          ].join(' ')}
        >
          <p className="whitespace-pre-wrap">{renderInlineMarkdown(content)}</p>
        </div>
      </div>
    </div>
  );
}
