'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-WALLET slice 2 — staff consultation bookings + No-Show/Completed/Cancel.
// Admins see all; a consultant sees their assigned bookings. NO_SHOW / CANCELLED
// on a paid booking post the tiered wallet credit server-side (atomic).

interface Row {
  id: string;
  type: string;
  status: string;
  paymentStatus: string;
  amountNZD: number;
  scheduledAt: string | null;
  timezone: string | null;
  staffName: string | null;
  clientName: string;
  startedOrPast: boolean;
}

const TYPE_LABEL: Record<string, string> = { FREE_15: 'Free 15-min', GAP_CLOSING: 'Gap-Closing', LIA: 'LIA', ADMISSION: 'Admission' };
const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30',
  BOOKED: 'bg-sorena-gold/15 text-sorena-navy border border-sorena-gold/40',
  COMPLETED: 'bg-sorena-navy/10 text-sorena-navy border border-sorena-navy/20',
  CANCELLED: 'bg-gray-100 text-gray-500 border border-gray-200',
  NO_SHOW: 'bg-red-50 text-red-600 border border-red-200',
};

function fmt(iso: string | null, tz: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz ?? 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function StaffBookingsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(() => {
    api.get<Row[]>('/staff/bookings')
      .then((r) => setRows(r))
      .catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function mark(id: string, status: 'NO_SHOW' | 'COMPLETED' | 'CANCELLED') {
    setBusyId(id); setMsg(null);
    try {
      await api.patch(`/staff/consultations/${id}/status`, { status });
      setMsg({ kind: 'ok', text: status === 'NO_SHOW' ? 'Marked no-show — refund credited to the client’s wallet.' : status === 'CANCELLED' ? 'Cancelled — refund credited per policy.' : 'Marked completed.' });
      load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not update the booking.' });
    } finally { setBusyId(null); }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-center gap-2">
        <CalendarClock size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">Bookings</h1>
      </div>

      {msg && (
        <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${msg.kind === 'ok' ? 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {error && <p className="text-sm text-red-600">Couldn’t load bookings. Please refresh.</p>}
      {!rows && !error && <div className="flex items-center gap-2 py-12 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading…</div>}
      {rows && rows.length === 0 && <p className="py-10 text-center text-sm text-sorena-text/60">No bookings in the last 30 days or upcoming.</p>}

      <div className="space-y-2">
        {rows?.map((b) => {
          const active = b.status === 'CONFIRMED' || b.status === 'BOOKED';
          const busy = busyId === b.id;
          return (
            <div key={b.id} className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sorena-navy">{b.clientName}</span>
                    <span className="rounded-full bg-sorena-gold/20 px-2 py-0.5 text-[11px] font-medium text-[#8a6d10]">{TYPE_LABEL[b.type] ?? b.type}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[b.status] ?? 'bg-gray-100 text-gray-500'}`}>{b.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-sorena-text/70">{fmt(b.scheduledAt, b.timezone)}{b.staffName ? ` · ${b.staffName}` : ''}</p>
                  <p className="text-xs text-sorena-text/50">NZD {b.amountNZD} · {b.paymentStatus}</p>
                </div>
                {active && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button type="button" disabled={busy} onClick={() => mark(b.id, 'COMPLETED')} className="rounded-lg border border-sorena-navy/20 px-2.5 py-1 text-xs font-semibold text-sorena-navy hover:bg-sorena-navy/5 disabled:opacity-50">Completed</button>
                    <button type="button" disabled={busy || !b.startedOrPast} title={b.startedOrPast ? '' : 'Available after the session start time'} onClick={() => mark(b.id, 'NO_SHOW')} className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40">No-show</button>
                    <button type="button" disabled={busy} onClick={() => mark(b.id, 'CANCELLED')} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
