'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Loader2, Video, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/date';

// PR-SALES-CONSULTATIONS — every consultation on a lead this rep owns.
//
// Grouped by what the rep has to DO about it, not by date order: the sessions
// still to come are the ones needing preparation or a nudge, and a booking with
// nothing scheduled is the one most likely to be forgotten. Past sessions are
// kept for context but pushed below.

interface Consultation {
  id: string;
  type: 'ADMISSION' | 'LIA' | 'FREE_15' | 'GAP_CLOSING';
  status: 'BOOKED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  paymentStatus: string | null;
  amountNZD: number | null;
  currency: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  meetingLink: string | null;
  decision: string | null;
  clientName: string | null;
  clientEmail: string | null;
  assignedToName: string | null;
  lead: { id: string; clientId: string | null; leadStatus: string } | null;
}

const TYPE_LABEL: Record<string, string> = {
  FREE_15: 'Free 15-min',
  ADMISSION: 'Admission',
  LIA: 'Adviser (LIA)',
  GAP_CLOSING: 'Gap closing',
};

const STATUS_TONE: Record<string, string> = {
  BOOKED: 'bg-blue-50 text-blue-700 ring-blue-200',
  CONFIRMED: 'bg-green-50 text-green-700 ring-green-200',
  COMPLETED: 'bg-gray-100 text-gray-600 ring-gray-200',
  CANCELLED: 'bg-red-50 text-red-700 ring-red-200',
  NO_SHOW: 'bg-amber-50 text-amber-800 ring-amber-200',
};

const PAYMENT_TONE: Record<string, string> = {
  PAID: 'bg-green-50 text-green-700 ring-green-200',
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200',
  REFUNDED: 'bg-gray-100 text-gray-600 ring-gray-200',
  FAILED: 'bg-red-50 text-red-700 ring-red-200',
};

function Pill({ text, tone }: { text: string; tone: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}>
      {text}
    </span>
  );
}

function money(amount: number | null, currency: string | null) {
  if (amount == null) return null;
  if (amount === 0) return 'Free';
  const code = (currency ?? 'usd').toUpperCase();
  return `${code} ${amount.toFixed(2)}`;
}

function when(c: Consultation) {
  if (!c.scheduledAt) return 'Not scheduled yet';
  const d = formatDate(c.scheduledAt);
  const t = new Date(c.scheduledAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });
  return `${d} · ${t}${c.durationMinutes ? ` · ${c.durationMinutes} min` : ''}`;
}

function Row({ c }: { c: Consultation }) {
  const payment = c.paymentStatus;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-gray-100 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sorena-navy">{c.clientName ?? 'Unknown client'}</span>
          {c.lead?.clientId && (
            <code className="font-mono text-[11px] text-sorena-text/45">{c.lead.clientId}</code>
          )}
          <Pill text={TYPE_LABEL[c.type] ?? c.type} tone="bg-sorena-navy/5 text-sorena-navy ring-sorena-navy/10" />
          <Pill text={c.status.replace('_', ' ')} tone={STATUS_TONE[c.status] ?? 'bg-gray-100 text-gray-600 ring-gray-200'} />
          {payment && <Pill text={payment} tone={PAYMENT_TONE[payment] ?? 'bg-gray-100 text-gray-600 ring-gray-200'} />}
          {c.decision && <Pill text={`Verdict: ${c.decision}`} tone="bg-purple-50 text-purple-700 ring-purple-200" />}
        </div>
        <p className="mt-1 text-sm text-sorena-text/70">
          {when(c)}
          {c.assignedToName && <> · with {c.assignedToName}</>}
          {money(c.amountNZD, c.currency) && <> · {money(c.amountNZD, c.currency)}</>}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {c.meetingLink && (
          <a
            href={c.meetingLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-sorena-navy px-3 py-1.5 text-xs font-semibold text-sorena-navy hover:bg-sorena-navy/5"
          >
            <Video size={13} /> Join
          </a>
        )}
        {c.lead && (
          <Link href={`/sales/leads/${c.lead.id}`} className="text-xs font-semibold text-sorena-navy hover:underline">
            View lead
          </Link>
        )}
      </div>
    </li>
  );
}

function Section({ title, hint, rows }: { title: string; hint?: string; rows: Consultation[] }) {
  if (!rows.length) return null;
  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-navy">{title}</h2>
        <span className="text-xs tabular-nums text-sorena-text/50">{rows.length}</span>
      </div>
      {hint && <p className="mb-2 text-xs text-sorena-text/55">{hint}</p>}
      <ul>{rows.map((c) => <Row key={c.id} c={c} />)}</ul>
    </section>
  );
}

export function SalesConsultationsClient() {
  const [rows, setRows] = useState<Consultation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Consultation[]>('/staff/consultations')
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => setError(e?.message ?? 'Couldn’t load consultations.'));
  }, []);

  const groups = useMemo(() => {
    const all = rows ?? [];
    const now = Date.now();
    const live = (c: Consultation) => c.status === 'BOOKED' || c.status === 'CONFIRMED';
    return {
      unscheduled: all.filter((c) => !c.scheduledAt && live(c)),
      upcoming: all.filter((c) => c.scheduledAt && new Date(c.scheduledAt).getTime() >= now && live(c)),
      past: all.filter((c) => (c.scheduledAt && new Date(c.scheduledAt).getTime() < now) || !live(c)),
    };
  }, [rows]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">Consultations</h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-sorena-text/70">
        Every consultation booked by a client on one of your leads — including the sessions
        an adviser or admission officer runs on your behalf.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!rows && !error && (
        <div className="flex items-center gap-2 py-12 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle size={22} className="mx-auto mb-2 text-sorena-text/30" />
          <p className="font-semibold text-sorena-navy">No consultations yet</p>
          <p className="mt-1 text-sm text-sorena-text/60">
            They appear here as soon as a client on one of your leads books a session.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <Section
            title="Needs scheduling"
            hint="Booked but no time set — the ones most easily forgotten."
            rows={groups.unscheduled}
          />
          <Section title="Upcoming" rows={groups.upcoming} />
          <Section title="Past" rows={groups.past} />
        </>
      )}
    </div>
  );
}
