'use client';

import { Lock, FileText, Paperclip } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { TicketSystemEvent } from '@/components/tickets/TicketSystemEvent';

// PR-SUPPORT-1 / PR-TICKETS-RICH — Staff-side message renderer.
//
// Staff messages are now rich text: when `bodyIsHtml` is true the body is
// server-sanitized HTML (allowlist: bold/italic/underline/lists/links; no
// images/scripts) rendered via dangerouslySetInnerHTML. Legacy/plain and client
// messages (`bodyIsHtml` false) render as escaped text. Attachments (image/PDF)
// render as a thumbnail/file list under the bubble, each a short-lived signed URL.

export interface TicketAttachment {
  name: string;
  mime: string;
  size: number;
  url: string | null;
}

export interface StaffThreadMessage {
  id: string;
  authorRole: 'CLIENT' | 'STAFF' | 'SYSTEM';
  authorName: string | null;
  authorStaffRole?: string | null;
  body: string;
  bodyIsHtml?: boolean;
  attachments?: TicketAttachment[];
  isInternalNote: boolean;
  createdAt: string;
}

const NAVY = '#1E3A5F';

export function StaffTicketMessages({ messages }: { messages: StaffThreadMessage[] }) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((m) => {
        if (m.authorRole === 'SYSTEM') {
          return <TicketSystemEvent key={m.id} body={m.body} createdAt={m.createdAt} />;
        }
        return <StaffMessageBubble key={m.id} message={m} />;
      })}
      <style jsx global>{`
        .rte-content ul { list-style: disc; margin: 0.25rem 0 0.25rem 1.25rem; }
        .rte-content ol { list-style: decimal; margin: 0.25rem 0 0.25rem 1.25rem; }
        .rte-content a { color: ${NAVY}; text-decoration: underline; }
      `}</style>
    </div>
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Attachments({ items }: { items: TicketAttachment[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a, i) => {
        const isImage = a.mime.startsWith('image/');
        if (isImage && a.url) {
          return (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}
               className="block overflow-hidden rounded-lg border border-black/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className="h-24 w-24 object-cover" />
            </a>
          );
        }
        return (
          <a key={i} href={a.url ?? '#'} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs text-[#1E3A5F] hover:bg-[#faf8f3] max-w-[220px]">
            <FileText size={15} className="shrink-0 text-[#b8941f]" />
            <span className="truncate font-medium">{a.name}</span>
            <span className="shrink-0 text-[10px] text-[#4A4A4A]/60">{fmtSize(a.size)}</span>
          </a>
        );
      })}
    </div>
  );
}

function StaffMessageBubble({ message }: { message: StaffThreadMessage }) {
  const isStaff = message.authorRole === 'STAFF';
  const isInternal = message.isInternalNote;
  const align = isStaff ? 'justify-end' : 'justify-start';

  const bubbleClasses = isInternal
    ? 'bg-amber-50 border border-amber-200 text-amber-950'
    : isStaff
      ? 'bg-[#e8edf5] text-[#1E3A5F]'
      : 'bg-[#FAF8F3] text-[#1E3A5F]';

  const hasBody = (message.body ?? '').trim().length > 0;

  return (
    <div className={`flex ${align}`}>
      <div className="max-w-[85%] md:max-w-[70%]">
        <div className="flex items-baseline gap-2 px-1 pb-1 text-xs text-slate-500">
          <span className="font-semibold text-[#1E3A5F]">
            {message.authorName ?? (isStaff ? 'Staff' : 'Client')}
          </span>
          {message.authorStaffRole && isStaff && (
            <span className="text-[10px] uppercase tracking-wide text-[#4A4A4A]/60">
              {message.authorStaffRole}
            </span>
          )}
          <span>•</span>
          <span>{formatRelativeTime(message.createdAt)}</span>
        </div>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${bubbleClasses}`}>
          {isInternal && (
            <div className="mb-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-800">
              <Lock size={10} /> Internal note · not visible to client
            </div>
          )}
          {hasBody && (
            message.bodyIsHtml
              // Server-sanitized HTML (rich-text-sanitizer allowlist).
              ? <div className="rte-content" dangerouslySetInnerHTML={{ __html: message.body }} />
              : <p className="whitespace-pre-wrap">{message.body}</p>
          )}
          {!hasBody && message.attachments?.length ? (
            <p className="inline-flex items-center gap-1 text-xs text-[#4A4A4A]/60">
              <Paperclip size={11} /> {message.attachments.length} attachment{message.attachments.length === 1 ? '' : 's'}
            </p>
          ) : null}
          <Attachments items={message.attachments ?? []} />
        </div>
      </div>
    </div>
  );
}
