'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PhoneCall, Loader2, CheckCircle2, ArrowRight, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-NURTURE — the Client Officer's open nurture call tasks, oldest-due first.
// Reuses the bookings "mine, due-first" shape. Log an outcome (Done/Skipped) or
// stop the whole sequence for a lead who's re-engaged directly.

interface CallTask {
  id: string; step: number; dueDate: string;
  leadId: string; clientId: string | null; clientName: string | null; clientEmail: string | null;
  reason: string | null; assignedToName: string | null;
}

// Call steps 2/4/7 → human labels.
const STEP_LABEL: Record<number, string> = {
  2: 'Call 1 · Day 3',
  4: 'Call 2 · Day 9',
  7: 'Final call · Day 21',
};

export function FollowUpsClient() {
  const [tasks, setTasks] = useState<CallTask[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get<CallTask[]>('/staff/nurture/my-tasks').then(setTasks).catch(() => setError(true));
  };
  useEffect(load, []);

  const logOutcome = async (taskId: string, status: 'DONE' | 'SKIPPED') => {
    setBusy(true);
    try {
      await api.post(`/staff/nurture/tasks/${taskId}/outcome`, { status, outcomeNotes: notes || undefined });
      toast.success(status === 'DONE' ? 'Call logged.' : 'Task skipped.');
      setOpenId(null); setNotes('');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the outcome');
    } finally { setBusy(false); }
  };

  const stopNurture = async (leadId: string) => {
    setBusy(true);
    try {
      await api.post('/staff/nurture/stop', { leadId });
      toast.success('Nurture stopped for this lead — open tasks closed.');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not stop the sequence');
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <PhoneCall size={22} className="text-[#1e3a5f]" />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Follow-ups</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Your open nurture call tasks — leads who finished a free consultation but haven’t committed yet. Oldest first.
        </p>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn’t load your follow-ups. Please refresh.</div>}

      {!tasks && !error && (
        <Card><CardContent><div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div></CardContent></Card>
      )}

      {tasks && tasks.length === 0 && (
        <Card><CardContent>
          <div className="py-12 text-center">
            <CheckCircle2 size={30} className="mx-auto text-[#c9a961] mb-2" />
            <p className="text-sm font-medium text-[#4A4A4A]">No calls due</p>
            <p className="text-xs text-gray-400 mt-1">You’re all caught up on nurture follow-ups.</p>
          </div>
        </CardContent></Card>
      )}

      {tasks && tasks.length > 0 && (
        <Card><CardContent className="p-0">
          <ul className="divide-y divide-gray-50">
            {tasks.map((t) => (
              <li key={t.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/staff/leads/${t.leadId}`} className="font-semibold text-[#1e3a5f] hover:underline">
                        {t.clientName ?? '—'}
                      </Link>
                      {t.clientId && <span className="font-mono text-[10px] text-gray-400">{t.clientId}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      <span className="font-semibold text-[#b28f4e]">{STEP_LABEL[t.step] ?? `Step ${t.step}`}</span>
                      {t.clientEmail ? ` · ${t.clientEmail}` : ''}
                    </div>
                    {t.reason && <div className="mt-1 text-xs text-gray-500">Reason: {t.reason}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                      <Clock size={11} /> due {formatRelativeTime(t.dueDate)}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setOpenId(openId === t.id ? null : t.id); setNotes(''); }}
                      className="inline-flex items-center gap-1 rounded-xl bg-[#1e3a5f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] transition-colors"
                    >
                      Log outcome <ArrowRight size={12} />
                    </button>
                  </div>
                </div>

                {openId === t.id && (
                  <div className="mt-3 rounded-xl border border-gray-100 bg-[#faf8f3] p-3">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="What happened on the call? (optional)"
                      rows={2}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" disabled={busy} onClick={() => logOutcome(t.id, 'DONE')}
                        className="rounded-lg bg-sorena-jade/90 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                        Mark done
                      </button>
                      <button type="button" disabled={busy} onClick={() => logOutcome(t.id, 'SKIPPED')}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        Skip
                      </button>
                      <button type="button" disabled={busy} onClick={() => stopNurture(t.leadId)}
                        className="ml-auto rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                        Stop nurture for this lead
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}
