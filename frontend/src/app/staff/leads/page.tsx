'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Users, Search, Filter, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { displayCountry } from '@/lib/country-codes';
import { Card, CardContent } from '@/components/ui/Card';
import { DateInput } from '@/components/ui/DateInput';
import { formatDate } from '@/lib/date';
import {
  LeadStatusChip,
  ALL_LEAD_STATUSES,
  type LeadStatus,
} from '@/components/leads/LeadStatusChip';
import {
  LeadSourceChip,
  COMMON_LEAD_SOURCES,
} from '@/components/leads/LeadSourceChip';
import {
  ScorecardBandChip,
  ALL_BANDS,
  type ScorecardBand,
} from '@/components/scorecard/ScorecardBandChip';

// PR-CRM-LEADS — Unified staff leads list.
//
// Filter state lives in the URL query string so refresh + share-url
// preserve the view. Search input is debounced 300ms before it
// rewrites the query. Pagination uses offset/limit cursors.

interface LeadListRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  source: string | null;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  scorecardBand: ScorecardBand | null;
  scorecardScore: number | null;
  scorecardSubmittedAt: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  attributedAgentName: string | null;
  trackingLinkChannel: string | null;
}

interface ListResponse {
  leads: LeadListRow[];
  total: number;
  limit: number;
  offset: number;
}

interface Assignee {
  id: string;
  name: string;
  role: string;
}

const PAGE_SIZE = 25;

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? '' : 's'} ago`;
  return formatDate(date);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export default function StaffLeadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Hydrate filters from URL on first paint and on back/forward.
  const filters = useMemo(() => ({
    search:       searchParams.get('search')       ?? '',
    source:       searchParams.get('source')       ?? '',
    status:       searchParams.get('status')       ?? '',
    band:         searchParams.get('band')         ?? '',
    assignedToId: searchParams.get('assignedToId') ?? '',
    dateFrom:     searchParams.get('dateFrom')     ?? '',
    dateTo:       searchParams.get('dateTo')       ?? '',
    offset:       parseInt(searchParams.get('offset') ?? '0', 10) || 0,
  }), [searchParams]);

  // Local-only search input — debounced before it rewrites the URL.
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => { setSearchInput(filters.search); }, [filters.search]);

  useEffect(() => {
    if (searchInput === filters.search) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput.trim().length > 0) params.set('search', searchInput.trim());
      else params.delete('search');
      params.set('offset', '0');
      router.replace(`/staff/leads?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const setFilter = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value.length > 0) params.set(key, value);
    else params.delete(key);
    params.set('offset', '0');
    router.replace(`/staff/leads?${params.toString()}`);
  }, [router, searchParams]);

  const setOffset = useCallback((offset: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('offset', String(Math.max(0, offset)));
    router.replace(`/staff/leads?${params.toString()}`);
  }, [router, searchParams]);

  const clearFilters = useCallback(() => {
    router.replace('/staff/leads');
  }, [router]);

  const hasActiveFilters =
    filters.search.length > 0 || filters.source.length > 0 || filters.status.length > 0
    || filters.band.length > 0 || filters.assignedToId.length > 0
    || filters.dateFrom.length > 0 || filters.dateTo.length > 0;

  // ─── Data fetch ──────────────────────────────────────────────────

  const queryStr = useMemo(() => {
    const q = new URLSearchParams();
    if (filters.search)       q.set('search', filters.search);
    if (filters.source)       q.set('source', filters.source);
    if (filters.status)       q.set('status', filters.status);
    if (filters.band)         q.set('band', filters.band);
    if (filters.assignedToId) q.set('assignedToId', filters.assignedToId);
    if (filters.dateFrom)     q.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)       q.set('dateTo', filters.dateTo);
    q.set('limit', String(PAGE_SIZE));
    q.set('offset', String(filters.offset));
    return q.toString();
  }, [filters]);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<ListResponse>(`/staff/leads?${queryStr}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? 'Failed to load leads.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [queryStr]);

  useEffect(() => {
    let cancelled = false;
    api.get<Assignee[]>('/staff/leads/assignees')
      .then((res) => { if (!cancelled) setAssignees(res); })
      .catch(() => { /* swallow — picker just stays empty */ });
    return () => { cancelled = true; };
  }, []);

  const total = data?.total ?? 0;
  const rows = data?.leads ?? [];

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Users size={22} className="text-[#b8941f]" />
            Leads
            <span className="ml-1 text-xs font-semibold uppercase tracking-wide bg-[#FAF8F3] text-[#1E3A5F]/80 px-2 py-0.5 rounded-full border border-[#1E3A5F]/15">
              {total.toLocaleString('en-NZ')}
            </span>
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Every lead across every channel. Click a row to see details, change status,
            and review payments.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <FilterLabel icon={<Search size={11} />}>Search</FilterLabel>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#4A4A4A]/60" />
                <input
                  type="text"
                  placeholder="Name, email, or phone…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 pl-7 pr-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <div>
              <FilterLabel>Source</FilterLabel>
              <select
                value={filters.source}
                onChange={(e) => setFilter('source', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All sources</option>
                {COMMON_LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <FilterLabel>Status</FilterLabel>
              <select
                value={filters.status}
                onChange={(e) => setFilter('status', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All statuses</option>
                {ALL_LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replaceAll('_', ' ').toLowerCase()}</option>
                ))}
              </select>
            </div>

            <div>
              <FilterLabel>Band</FilterLabel>
              <select
                value={filters.band}
                onChange={(e) => setFilter('band', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All bands</option>
                {ALL_BANDS.map((b) => (
                  <option key={b} value={b}>{b.replace('_', ' ')}</option>
                ))}
                <option value="NONE">No scorecard</option>
              </select>
            </div>

            <div>
              <FilterLabel>Assignee</FilterLabel>
              <select
                value={filters.assignedToId}
                onChange={(e) => setFilter('assignedToId', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All assignees</option>
                <option value="unassigned">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                ))}
              </select>
            </div>

            <div>
              <FilterLabel>From (dd/mm/yyyy)</FilterLabel>
              <DateInput
                value={filters.dateFrom || null}
                onChange={(iso) => setFilter('dateFrom', iso ?? '')}
                minYear={2015}
                maxYear={new Date().getFullYear()}
              />
            </div>

            <div>
              <FilterLabel>To (dd/mm/yyyy)</FilterLabel>
              <DateInput
                value={filters.dateTo || null}
                onChange={(iso) => setFilter('dateTo', iso ?? '')}
                minYear={2015}
                maxYear={new Date().getFullYear()}
              />
            </div>
          </div>

          {hasActiveFilters && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 text-[#4A4A4A]/70">
                <Filter size={11} /> Filters applied
              </span>
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-[#1E3A5F] font-medium hover:text-[#b8941f]"
              >
                <X size={11} /> Clear all
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent>
          {loading && <div className="py-6 text-center text-sm text-[#4A4A4A]/60">Loading…</div>}

          {!loading && rows.length === 0 && (
            <div className="py-12 text-center">
              <Users size={32} className="mx-auto text-[#4A4A4A]/30 mb-2" />
              <p className="text-sm text-[#4A4A4A]/70">
                {hasActiveFilters
                  ? 'No leads match these filters. Try adjusting them or clearing all filters.'
                  : 'No leads yet. They’ll appear here as soon as the scorecard, Wix, or any other intake channel captures one.'}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#b8941f] font-medium"
                >
                  <X size={12} /> Clear filters
                </button>
              )}
            </div>
          )}

          {!loading && rows.length > 0 && (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-gray-200 text-xs uppercase tracking-wide text-[#4A4A4A]/70">
                      <th className="py-2 pr-3 font-semibold">Name</th>
                      <th className="py-2 pr-3 font-semibold">Source</th>
                      <th className="py-2 pr-3 font-semibold">Band</th>
                      <th className="py-2 pr-3 font-semibold">Score</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 pr-3 font-semibold">Country</th>
                      <th className="py-2 pr-3 font-semibold">Assignee</th>
                      <th className="py-2 pr-3 font-semibold">Created</th>
                      <th className="py-2 font-semibold w-0"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[#1E3A5F] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {initials(r.name)}
                            </div>
                            <div className="min-w-0">
                              <Link
                                href={`/staff/leads/${r.id}`}
                                className="text-[#1E3A5F] font-semibold hover:text-[#b8941f] transition-colors block truncate"
                              >
                                {r.name}
                              </Link>
                              {r.email && (
                                <div className="text-xs text-[#4A4A4A]/60 truncate">{r.email}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3"><LeadSourceChip source={r.source} compact /></td>
                        <td className="py-2.5 pr-3">
                          {r.scorecardBand
                            ? <ScorecardBandChip band={r.scorecardBand} compact />
                            : <span className="text-[#4A4A4A]/40">—</span>}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-[#1E3A5F]">
                          {r.scorecardScore ?? <span className="text-[#4A4A4A]/40">—</span>}
                        </td>
                        <td className="py-2.5 pr-3"><LeadStatusChip status={r.status} compact /></td>
                        <td className="py-2.5 pr-3 text-[#4A4A4A]">{displayCountry(r.country) ?? '—'}</td>
                        <td className="py-2.5 pr-3 text-[#4A4A4A]">
                          {r.assignedToName ?? <span className="italic text-[#4A4A4A]/60">Unassigned</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-[#4A4A4A]/70">
                          {relativeTime(r.createdAt)}
                        </td>
                        <td className="py-2.5">
                          <Link
                            href={`/staff/leads/${r.id}`}
                            className="text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="md:hidden space-y-2">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/staff/leads/${r.id}`}
                      className="block rounded-xl border border-gray-200 p-3 hover:border-[#F3CE49]/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[#1E3A5F] truncate">{r.name}</div>
                          {r.email && <div className="text-xs text-[#4A4A4A]/60 truncate">{r.email}</div>}
                        </div>
                        <LeadSourceChip source={r.source} compact />
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        <LeadStatusChip status={r.status} compact />
                        {r.scorecardBand && <ScorecardBandChip band={r.scorecardBand} compact />}
                        {r.assignedToName && (
                          <span className="text-[10px] text-[#4A4A4A]/70 inline-flex items-center font-semibold rounded-full border bg-gray-50 border-gray-200 px-2 py-0.5">
                            {r.assignedToName}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-xs text-[#4A4A4A]/60">
                        {relativeTime(r.createdAt)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Pagination */}
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-sm">
                <div className="text-xs text-[#4A4A4A]/70">
                  Showing {filters.offset + 1}-{Math.min(filters.offset + rows.length, total)} of {total}
                </div>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    disabled={filters.offset === 0}
                    onClick={() => setOffset(filters.offset - PAGE_SIZE)}
                    className="inline-flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg border border-gray-300 text-[#1E3A5F] disabled:opacity-40 hover:bg-gray-50"
                  >
                    <ChevronLeft size={12} /> Prev
                  </button>
                  <button
                    type="button"
                    disabled={filters.offset + rows.length >= total}
                    onClick={() => setOffset(filters.offset + PAGE_SIZE)}
                    className="inline-flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg border border-gray-300 text-[#1E3A5F] disabled:opacity-40 hover:bg-gray-50"
                  >
                    Next <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FilterLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[#4A4A4A]/70 mb-1">
      {icon}{children}
    </label>
  );
}
