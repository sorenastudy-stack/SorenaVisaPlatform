'use client';

import { Lock } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { TicketSystemEvent } from '@/components/tickets/TicketSystemEvent';

// PR-SUPPORT-1 — Staff-side message renderer.
//
// The client-side TicketMessage component hardcodes "You" for CLIENT
// messages and has no styling for internal staff notes. Staff need
// the actual author name on every bubble + a visually distinct
// amber-tinted style for isInternalNote=true. This component handles
// both. SYSTEM rows are delegated to the existing TicketSystemEvent.

export interface StaffThreadMessage {
  id: string;
  authorRole: 'CLIENT' | 'STAFF' | 'SYSTEM';
  authorName: string | null;
  authorStaffRole?: string | null;
  body: string;
  isInternalNote: boolean;
  createdAt: string;
}

export function StaffTicketMessages({ messages }: { messages: StaffThreadMessage[] }) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((m) => {
        if (m.authorRole === 'SYSTEM') {
          return <TicketSystemEvent key={m.id} body={m.body} createdAt={m.createdAt} />;
        }
        return <StaffMessageBubble key={m.id} message={m} />;
      })}
    </div>
  );
}

function StaffMessageBubble({ message }: { message: StaffThreadMessage }) {
  const isStaff = message.authorRole === 'STAFF';
  const isInternal = message.isInternalNote;

  // STAFF on the right (the viewer is staff — staff messages are
  // "ours"). CLIENT on the left. Internal notes always get the
  // amber-tinted bubble regardless of side.
  const align = isStaff ? 'justify-end' : 'justify-start';

  const bubbleClasses = isInternal
    ? 'bg-amber-50 border border-amber-200 text-amber-950'
    : isStaff
      ? 'bg-[#e8edf5] text-[#1E3A5F]'
      : 'bg-[#FAF8F3] text-[#1E3A5F]';

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
          <p className="whitespace-pre-wrap">{message.body}</p>
        </div>
      </div>
    </div>
  );
}
