'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Inbox, Loader2, Check, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';

// PR-HANDOFF — the cases a colleague has passed to this person.
//
// Not a queue. Handoffs are accepted the moment they are made, so there is
// nothing here to action and nothing waiting on the reader — this answers
// "what landed on my desk lately", newest first. Opening a case is what gets
// recorded (firstViewedAt), passively, with nothing gated on it.

const SLOT_LABEL: Record<string, string> = {
  ADMISSION: 'Admission',
  SUPPORT: 'Student Support',
  FINANCE: 'Finance',
  LIA: 'Immigration Adviser',
};

interface QueueRow {
  id: string;
  fromSlot: string;
  toSlot: string;
  fromUserName: string | null;
  note: string | null;
  createdAt: string;
  case: {
    id: string;
    stage: string | null;
    lead: { clientId: string | null; contact: { fullName: string | null; email: string | null } | null } | null;
  } | null;
}

function waitingFor(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function MyQueueClient() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<QueueRow[]>('/staff/handoffs/my-queue'));
    } catch (e: any) {
      setError(e?.message ?? 'Couldn’t load your queue.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-1 flex items-center gap-2">
        <Inbox size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">Handed to me</h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-sorena-text/70">
        Cases a colleague has passed to you, most recent first. Nothing here needs
        acknowledging — each one is already yours.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {!rows && !error && (
        <div className="flex items-center gap-2 py-12 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {rows?.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <Check size={22} className="mx-auto mb-2 text-sorena-jade" />
          <p className="font-semibold text-sorena-navy">Nothing handed to you yet</p>
          <p className="mt-1 text-sm text-sorena-text/60">
            Cases a colleague passes to you appear here, and you’ll get an email when one does.
          </p>
        </div>
      )}

      {!!rows?.length && (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold text-sorena-navy">
                      {r.case?.lead?.contact?.fullName ?? 'Unknown client'}
                    </span>
                    {r.case?.lead?.clientId && (
                      <code className="font-mono text-[11px] text-sorena-text/45">{r.case.lead.clientId}</code>
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-sorena-text/70">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-sorena-text/70">
                      {SLOT_LABEL[r.fromSlot] ?? r.fromSlot}
                    </span>
                    <ArrowRight size={13} className="text-sorena-text/40" />
                    <span className="rounded bg-sorena-navy/5 px-1.5 py-0.5 text-xs font-semibold text-sorena-navy">
                      {SLOT_LABEL[r.toSlot] ?? r.toSlot}
                    </span>
                    <span className="text-sorena-text/50">
                      · from {r.fromUserName ?? 'a colleague'} · {waitingFor(r.createdAt)}
                    </span>
                  </p>
                  {r.note && (
                    <p className="mt-2 rounded-lg bg-[#faf8f3] px-3 py-2 text-sm text-sorena-text/80">
                      “{r.note}”
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {r.case && (
                    <Link
                      href={`/staff/cases/${r.case.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sorena-navy px-3 py-2 text-sm font-bold text-white hover:bg-[#162d49]"
                    >
                      Open case <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
