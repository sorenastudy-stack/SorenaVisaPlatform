'use client';

import { useEffect, useState } from 'react';
import { CalendarOff, Loader2, Plus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { DateInput } from '@/components/ui/DateInput';

// PR-BOOKING-ADMIN-B slice 2 — staff self-service "My Leave".
//
// Any staff member requests their own time off here. A request is PENDING
// until an admin approves it — but the days come out of booking availability
// immediately (the backend treats a pending request like approved leave for
// blocking new bookings). Withdrawing a pending request reopens the days.

interface Leave {
  id: string; startDate: string; endDate: string; kind: string;
  status: string; reason: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  REQUESTED: 'bg-sorena-gold/15 text-sorena-navy border border-sorena-gold/40',
  APPROVED: 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30',
  REJECTED: 'bg-red-50 text-red-600 border border-red-200',
  CANCELLED: 'bg-gray-100 text-gray-500 border border-gray-200',
};
const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Withdrawn',
};

function fmtRange(start: string, end: string): string {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

const MIN_YEAR = new Date().getFullYear();
const MAX_YEAR = new Date().getFullYear() + 2;

export function MyLeaveClient() {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Leave[]>('/staff/me/leave')
      .then((rows) => { if (!cancelled) setLeaves(rows); })
      .catch(() => { /* non-fatal — section shows empty */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    setMsg(null);
    if (!start || !end) { setMsg({ kind: 'err', text: 'Pick a start and end date.' }); return; }
    if (end < start) { setMsg({ kind: 'err', text: 'End date must be on or after start date.' }); return; }
    setSubmitting(true);
    try {
      const created = await api.post<Leave>('/staff/me/leave', {
        startDate: start, endDate: end, reason: reason || undefined,
      });
      setLeaves((prev) => [created, ...prev]);
      setStart(''); setEnd(''); setReason('');
      setMsg({ kind: 'ok', text: 'Request submitted. Those days are now held pending approval.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not submit your request.' });
    } finally { setSubmitting(false); }
  }

  async function withdraw(id: string) {
    setMsg(null);
    try {
      await api.delete(`/staff/me/leave/${id}`);
      setLeaves((prev) => prev.map((l) => (l.id === id ? { ...l, status: 'CANCELLED' } : l)));
      setMsg({ kind: 'ok', text: 'Request withdrawn. Those days are available again.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not withdraw the request.' });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-center gap-2">
        <CalendarOff size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">My leave</h1>
      </div>

      {msg && (
        <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${msg.kind === 'ok' ? 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {/* Request form */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">Request time off</h2>
        <p className="mt-2 text-xs text-sorena-text/50">
          Full days only. Your request is pending until an admin approves it, but these days are removed from your booking availability straight away.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-sorena-navy mb-1">From <span className="font-normal text-sorena-text/40">(dd/mm/yyyy)</span></label>
            <DateInput value={start || null} onChange={(iso) => setStart(iso ?? '')} minYear={MIN_YEAR} maxYear={MAX_YEAR} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-sorena-navy mb-1">To <span className="font-normal text-sorena-text/40">(dd/mm/yyyy)</span></label>
            <DateInput value={end || null} onChange={(iso) => setEnd(iso ?? '')} minYear={MIN_YEAR} maxYear={MAX_YEAR} />
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-xs font-semibold text-sorena-navy mb-1">Reason (optional)</label>
          <input type="text" value={reason} maxLength={500} placeholder="e.g. Annual leave" onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        </div>
        <div className="mt-4">
          <button onClick={submit} disabled={submitting} className="inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl bg-sorena-gold px-5 py-2 text-sm font-semibold text-sorena-navy shadow-sm transition-all hover:bg-sorena-gold/90 disabled:opacity-60">
            {submitting ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : <><Plus size={15} /> Request leave</>}
          </button>
        </div>
      </section>

      {/* My requests */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">My requests</h2>
        <div className="mt-4 space-y-2">
          {!loaded ? (
            <div className="flex items-center gap-2 py-6 text-sm text-sorena-text/50"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : leaves.length === 0 ? (
            <p className="text-xs text-sorena-text/40">You have no leave requests.</p>
          ) : (
            leaves.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-sorena-navy">{fmtRange(l.startDate, l.endDate)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[l.status] ?? 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[l.status] ?? l.status}</span>
                  </div>
                  {l.reason && <p className="mt-0.5 truncate text-xs text-sorena-text/50">{l.reason}</p>}
                </div>
                {l.status === 'REQUESTED' && (
                  <button type="button" onClick={() => withdraw(l.id)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-sorena-text/60 hover:border-red-300 hover:text-red-600">
                    <X size={13} /> Withdraw
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
