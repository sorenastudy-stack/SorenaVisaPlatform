'use client';

import { TicketMessage } from './TicketMessage';
import { TicketSystemEvent } from './TicketSystemEvent';

// PR-DASH-2 — Scrollable thread of messages.
//
// Each item dispatches to TicketMessage or TicketSystemEvent based on
// authorRole. The thread itself is just a vertical stack with
// generous gap; the page provides any height constraint or scroll
// container above it.
export interface ThreadMessage {
  id: string;
  authorRole: 'CLIENT' | 'STAFF' | 'SYSTEM';
  authorDisplayName: string;
  body: string;
  createdAt: string;
}

export function TicketMessageThread({ messages }: { messages: ThreadMessage[] }) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((m) =>
        m.authorRole === 'SYSTEM' ? (
          <TicketSystemEvent key={m.id} body={m.body} createdAt={m.createdAt} />
        ) : (
          <TicketMessage
            key={m.id}
            authorRole={m.authorRole}
            authorDisplayName={m.authorDisplayName}
            body={m.body}
            createdAt={m.createdAt}
          />
        ),
      )}
    </div>
  );
}
