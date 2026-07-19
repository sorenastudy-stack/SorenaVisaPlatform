'use client';

import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-DASH-2 / PR-TICKETS-RICH — One message bubble.
//
// CLIENT messages right-align with an off-white bubble; STAFF messages left-align
// with a soft navy tint. Staff replies are now rich text: when `bodyIsHtml` is
// true the body is server-sanitized HTML (allowlist — no images/scripts) rendered
// via dangerouslySetInnerHTML; otherwise it renders as escaped text. Attachments
// (image/PDF, short-lived signed URLs) render under the bubble.

export interface TicketMessageAttachment {
  name: string;
  mime: string;
  size: number;
  url: string | null;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TicketMessage({
  authorRole,
  authorDisplayName,
  body,
  bodyIsHtml,
  attachments,
  createdAt,
}: {
  authorRole: 'CLIENT' | 'STAFF' | 'SYSTEM';
  authorDisplayName: string;
  body: string;
  bodyIsHtml?: boolean;
  attachments?: TicketMessageAttachment[];
  createdAt: string;
}) {
  const t = useTranslations();
  const isClient = authorRole === 'CLIENT';
  const hasBody = (body ?? '').trim().length > 0;
  return (
    <div className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%] md:max-w-[70%]">
        <div className="flex items-baseline gap-2 px-1 pb-1 text-xs text-slate-500">
          <span className="font-semibold text-sorena-navy">
            {isClient ? t('tickets.detail.authorYou') : authorDisplayName}
          </span>
          <span>•</span>
          <span>{formatRelativeTime(createdAt)}</span>
        </div>
        <div
          className={[
            'rounded-2xl px-4 py-3 text-sm leading-relaxed',
            isClient
              ? 'bg-[#faf8f3] text-sorena-navy'
              : 'bg-[#e8edf5] text-sorena-navy',
          ].join(' ')}
        >
          {hasBody && (
            bodyIsHtml
              ? <div className="rte-content" dangerouslySetInnerHTML={{ __html: body }} />
              : <p className="whitespace-pre-wrap">{body}</p>
          )}
          {attachments && attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => {
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
                     className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs text-sorena-navy hover:bg-[#faf8f3] max-w-[220px]">
                    <FileText size={15} className="shrink-0 text-[#b8941f]" />
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{fmtSize(a.size)}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <style jsx global>{`
        .rte-content ul { list-style: disc; margin: 0.25rem 0 0.25rem 1.25rem; }
        .rte-content ol { list-style: decimal; margin: 0.25rem 0 0.25rem 1.25rem; }
        .rte-content a { color: #1e3a5f; text-decoration: underline; }
      `}</style>
    </div>
  );
}
