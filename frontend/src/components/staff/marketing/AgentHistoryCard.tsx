'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-AGENT-PORTAL-2 — the agent's change history.
//
// Reads the audit rows that were ALREADY being written and simply had nowhere to
// be seen: created, updated, status changed, contract manually cleared, and now
// rate changed. No new storage, no second source of truth.
//
// The one-line summaries come from the server so the wording is identical
// wherever history is shown, and so this component never has to understand the
// shape of a JSON payload it did not write.

interface Entry {
  id: string;
  eventType: string;
  at: string;
  actorName: string | null;
  actorRole: string | null;
  summary: string;
}

export function AgentHistoryCard({ agentId }: { agentId: string }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get<Entry[]>(`/staff/marketing/agents/${agentId}/history`)
      .then(setRows)
      .catch(() => setFailed(true));
  }, [agentId]);

  return (
    <Card className="mb-6">
      <CardContent>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60">
          <History size={14} /> History
        </h2>

        {failed ? (
          <p className="text-sm text-[#4A4A4A]/60">Could not load the history.</p>
        ) : rows === null ? (
          <p className="text-sm text-[#4A4A4A]/50">Loading…</p>
        ) : rows.length === 0 ? (
          // An agent created before audit rows existed genuinely has none.
          <p className="text-sm text-[#4A4A4A]/60">Nothing recorded for this agent yet.</p>
        ) : (
          <ol className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="border-l-2 border-[#c9a961]/40 pl-3">
                <p className="text-sm text-[#1E3A5F]">{r.summary}</p>
                <p className="mt-0.5 text-[11px] text-[#4A4A4A]/60">
                  {new Date(r.at).toLocaleString('en-NZ', {
                    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                  {r.actorName ? ` · ${r.actorName}` : ''}
                  {r.actorRole ? ` (${r.actorRole})` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
