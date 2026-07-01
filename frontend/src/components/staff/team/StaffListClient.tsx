'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search, ChevronRight, BadgeCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { langLabel, sessionTypeLabel } from '@/lib/booking/staff-options';

interface StaffSummary {
  id: string; name: string; email: string; role: string; liaVerified: boolean;
  languages: string[]; timezone: string; bookableSessionTypes: string[];
  bookingActive: boolean; windowCount: number; availabilitySet: boolean; bookable: boolean;
}

function Chip({ children, tone = 'navy' }: { children: React.ReactNode; tone?: 'navy' | 'gold' | 'muted' }) {
  const tones: Record<string, string> = {
    navy: 'bg-sorena-navy/10 text-sorena-navy',
    gold: 'bg-sorena-gold/20 text-[#8a6d10]',
    muted: 'bg-gray-100 text-gray-500',
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function StaffListClient() {
  const [rows, setRows] = useState<StaffSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<StaffSummary[]>('/staff/team')
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((a) => {
      if (q && !a.name.toLowerCase().includes(q.toLowerCase()) && !a.email.toLowerCase().includes(q.toLowerCase())) return false;
      if (needsSetup && a.bookableSessionTypes.length > 0 && a.availabilitySet) return false;
      return true;
    });
  }, [rows, q, needsSetup]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-sorena-navy">Staff</h1>
      </div>
      <p className="text-sm text-sorena-text/60 mb-6">
        Configure booking for staff (advisers &amp; consultants). To add a new staff member, use{' '}
        <Link href="/staff/users" className="font-semibold text-sorena-navy underline">Staff</Link>.
      </p>

      {/* Controls */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-sorena-navy/30"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-sorena-text/70">
          <input type="checkbox" checked={needsSetup} onChange={(e) => setNeedsSetup(e.target.checked)} className="h-4 w-4 rounded" />
          Needs setup
        </label>
      </div>

      {error && <p className="text-sm text-red-600">Couldn&apos;t load staff. Please refresh.</p>}
      {!rows && !error && (
        <div className="flex items-center gap-2 py-12 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading staff…</div>
      )}

      {rows && filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-sorena-text/60">No staff match.</p>
      )}

      <div className="space-y-3">
        {filtered.map((a) => (
          <Link
            key={a.id}
            href={`/staff/team/${a.id}`}
            className="block rounded-2xl border border-gray-200 bg-white p-4 md:p-5 shadow-sm transition-all hover:border-sorena-navy/30 hover:shadow"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sorena-navy">{a.name}</span>
                  <Chip tone="muted">{a.role}</Chip>
                  {a.role === 'LIA' && a.liaVerified && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sorena-jade"><BadgeCheck size={13} /> verified</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-sorena-text/50">{a.email}</div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {a.languages.length > 0
                    ? a.languages.map((c) => <Chip key={c}>{langLabel(c)}</Chip>)
                    : <Chip tone="muted">no languages</Chip>}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {a.bookableSessionTypes.length > 0
                    ? a.bookableSessionTypes.map((t) => <Chip key={t} tone="gold">{sessionTypeLabel(t)}</Chip>)
                    : <Chip tone="muted">no session types</Chip>}
                </div>
                <div className="mt-2 text-xs text-sorena-text/60">
                  <span className="font-medium">{a.timezone}</span>
                  {' · '}
                  {a.availabilitySet ? `Set — ${a.windowCount} window${a.windowCount === 1 ? '' : 's'}` : 'Availability not set'}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                {a.bookable
                  ? <Chip tone="gold">Bookable</Chip>
                  : a.bookingActive
                    ? <Chip tone="muted">Not ready</Chip>
                    : <Chip tone="muted">Paused</Chip>}
                <ChevronRight size={18} className="text-gray-300" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
