'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { TicketListItem, type TicketRow } from './TicketListItem';

// PR-DASH-2 — Tickets list with filters + search.
//
// Filters (status + department) and search are entirely client-side.
// The server returns the full list (filters narrow the SQL only when
// passed via URL params, which we don't bother with for the
// in-page filter UI — there's no meaningful row-count savings at
// the scale a single client operates at).
//
// Status filter defaults to OPEN + IN_PROGRESS (per spec). Department
// filter is multi-select; empty means "show all".

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const DEPARTMENTS = [
  'ADMISSIONS',
  'VISA_APPLICATION',
  'DOCUMENTS',
  'PAYMENTS_FINANCE',
  'TECHNICAL_SUPPORT',
  'GENERAL_INQUIRY',
];

export function TicketList({ tickets }: { tickets: TicketRow[] }) {
  const t = useTranslations();
  const [statuses, setStatuses] = useState<Set<string>>(
    new Set(['OPEN', 'IN_PROGRESS']),
  );
  const [departments, setDepartments] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const toggle = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets.filter((t2) => {
      if (statuses.size > 0 && !statuses.has(t2.status)) return false;
      if (departments.size > 0 && !departments.has(t2.department)) return false;
      if (term !== '' && !t2.subject.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [tickets, statuses, departments, search]);

  const hasNoUnfiltered = tickets.length === 0;
  const hasNoFiltered = !hasNoUnfiltered && filtered.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold text-sorena-navy md:text-3xl">
            {t('tickets.list.header')}
          </h1>
          <p className="mt-1 text-sm text-[#4A4A4A]/70">Your support conversations with the Sorena team.</p>
        </div>
        <Link
          href="/student/tickets/new"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-sorena-gold px-6 text-base font-semibold text-white transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold focus-visible:ring-offset-2"
        >
          {t('tickets.list.openNew')}
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tickets.list.searchPlaceholder')}
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-sorena-navy placeholder:text-slate-400 focus:border-sorena-navy focus:outline-none"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            {t('tickets.list.filterStatus')}
          </p>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggle(statuses, s, setStatuses)}
                className={[
                  'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                  statuses.has(s)
                    ? 'border-sorena-navy bg-sorena-navy text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                {t(`tickets.status.${s}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            {t('tickets.list.filterDepartment')}
          </p>
          <div className="flex flex-wrap gap-2">
            {DEPARTMENTS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggle(departments, d, setDepartments)}
                className={[
                  'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                  departments.has(d)
                    ? 'border-sorena-navy bg-sorena-navy text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                {t(`tickets.department.${d}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex flex-col gap-3">
        {hasNoUnfiltered && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            {t('tickets.list.empty')}
          </p>
        )}
        {hasNoFiltered && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            {t('tickets.list.emptyFiltered')}
          </p>
        )}
        {filtered.map((tk) => (
          <TicketListItem key={tk.id} ticket={tk} />
        ))}
      </div>
    </div>
  );
}
