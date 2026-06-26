'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Inbox, Search, Filter, X, ChevronLeft, ChevronRight, RefreshCcw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge';
import { TicketDepartmentBadge } from '@/components/tickets/TicketDepartmentBadge';

// PR-SUPPORT-1 — Staff tickets list.
//
// Mirrors the staff leads list pattern: URL-state filters, debounced
// search, table on desktop / cards on mobile, pagination, empty +
// loading states. Reads the shape returned by GET /staff/tickets.

interface TicketRow {
  id: string;
  subject: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  department: 'ADMISSIONS' | 'VISA_APPLICATION' | 'DOCUMENTS' | 'PAYMENTS_FINANCE' | 'TECHNICAL_SUPPORT' | 'GENERAL_INQUIRY';
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  clientId: string;
  clientName: string | null;
  caseId: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  lastClientMessageAt: string | null;
  lastStaffMessageAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  tickets: TicketRow[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 25;

const PRIORITY_LABEL: Record<TicketRow['priority'], string> = {
  LOW: 'Low', NORMAL: 'Normal', HIGH: 'High',
};
const PRIORITY_STYLE: Record<TicketRow['priority'], string> = {
  LOW:    'bg-gray-100 text-gray-700 border-gray-200',
  NORMAL: 'bg-blue-50 text-blue-700 border-blue-200',
  HIGH:   'bg-red-50 text-red-700 border-red-200',
};

const DEPARTMENT_VALUES: TicketRow['department'][] = [
  'ADMISSIONS', 'VISA_APPLICATION', 'DOCUMENTS',
  'PAYMENTS_FINANCE', 'TECHNICAL_SUPPORT', 'GENERAL_INQUIRY',
];
const STATUS_VALUES: TicketRow['status'][] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function StaffTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters = useMemo(() => ({
    search:     searchParams.get('search')     ?? '',
    status:     searchParams.get('status')     ?? '',
    department: searchParams.get('department') ?? '',
    assigned:   searchParams.get('assigned')   ?? '',
    offset:     parseInt(searchParams.get('offset') ?? '0', 10) || 0,
  }), [searchParams]);

  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => { setSearchInput(filters.search); }, [filters.search]);

  useEffect(() => {
    if (searchInput === filters.search) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchInput.trim().length > 0) params.set('search', searchInput.trim());
      else params.delete('search');
      params.set('offset', '0');
      router.replace(`/staff/tickets?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const setFilter = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value.length > 0) params.set(key, value);
    else params.delete(key);
    params.set('offset', '0');
    router.replace(`/staff/tickets?${params.toString()}`);
  }, [router, searchParams]);

  const setOffset = useCallback((offset: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('offset', String(Math.max(0, offset)));
    router.replace(`/staff/tickets?${params.toString()}`);
  }, [router, searchParams]);

  const clearFilters = useCallback(() => {
    router.replace('/staff/tickets');
  }, [router]);

  const hasActiveFilters =
    filters.search.length > 0 || filters.status.length > 0
    || filters.department.length > 0 || filters.assigned.length > 0;

  const queryStr = useMemo(() => {
    const q = new URLSearchParams();
    if (filters.search)     q.set('search', filters.search);
    if (filters.status)     q.set('status', filters.status);
    if (filters.department) q.set('department', filters.department);
    if (filters.assigned)   q.set('assigned', filters.assigned);
    q.set('limit', String(PAGE_SIZE));
    q.set('offset', String(filters.offset));
    return q.toString();
  }, [filters]);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>(`/staff/tickets?${queryStr}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load tickets.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryStr]);

  const total = data?.total ?? 0;
  const rows = data?.tickets ?? [];

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Inbox size={22} className="text-[#b8941f]" />
            Support tickets
            <span className="ml-1 text-xs font-semibold uppercase tracking-wide bg-[#FAF8F3] text-[#1E3A5F]/80 px-2 py-0.5 rounded-full border border-[#1E3A5F]/15">
              {total.toLocaleString('en-NZ')}
            </span>
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Client questions, escalations, and internal staff threads. Click a row to open the conversation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#1E3A5F] text-[#1E3A5F] text-sm font-medium hover:bg-[#1E3A5F]/5"
        >
          <RefreshCcw size={13} /> Refresh
        </button>
      </div>

      <Card className="mb-4">
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <FilterLabel icon={<Search size={11} />}>Search subject</FilterLabel>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#4A4A4A]/60" />
                <input
                  type="text"
                  placeholder="Substring match on ticket subject…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 pl-7 pr-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div>
              <FilterLabel>Status</FilterLabel>
              <select
                value={filters.status}
                onChange={(e) => setFilter('status', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All statuses</option>
                {STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>{s.replaceAll('_', ' ').toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <FilterLabel>Department</FilterLabel>
              <select
                value={filters.department}
                onChange={(e) => setFilter('department', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All departments</option>
                {DEPARTMENT_VALUES.map((d) => (
                  <option key={d} value={d}>{d.replaceAll('_', ' ').toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <FilterLabel>Assignment</FilterLabel>
              <select
                value={filters.assigned}
                onChange={(e) => setFilter('assigned', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">All assignments</option>
                <option value="me">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </select>
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

      <Card>
        <CardContent>
          {loading && <div className="py-6 text-center text-sm text-[#4A4A4A]/60">Loading…</div>}

          {!loading && rows.length === 0 && (
            <div className="py-12 text-center">
              <Inbox size={32} className="mx-auto text-[#4A4A4A]/30 mb-2" />
              <p className="text-sm text-[#4A4A4A]/70">
                {hasActiveFilters
                  ? 'No tickets match these filters. Try adjusting them or clearing all filters.'
                  : 'No tickets yet. They’ll appear here as clients open support questions.'}
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
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-gray-200 text-xs uppercase tracking-wide text-[#4A4A4A]/70">
                      <th className="py-2 pr-3 font-semibold">Subject</th>
                      <th className="py-2 pr-3 font-semibold">Client</th>
                      <th className="py-2 pr-3 font-semibold">Department</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 pr-3 font-semibold">Priority</th>
                      <th className="py-2 pr-3 font-semibold">Assignee</th>
                      <th className="py-2 pr-3 font-semibold">Last activity</th>
                      <th className="py-2 font-semibold w-0"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const lastActivity = r.lastStaffMessageAt ?? r.lastClientMessageAt ?? r.createdAt;
                      return (
                        <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                          <td className="py-2.5 pr-3 max-w-[280px]">
                            <Link
                              href={`/staff/tickets/${r.id}`}
                              className="text-[#1E3A5F] font-semibold hover:text-[#b8941f] transition-colors block truncate"
                            >
                              {r.subject}
                            </Link>
                            <div className="text-xs text-[#4A4A4A]/60 mt-0.5">
                              {r.messageCount} message{r.messageCount === 1 ? '' : 's'}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3 text-[#1E3A5F]">
                            {r.clientName ?? <span className="italic text-[#4A4A4A]/60">unknown</span>}
                          </td>
                          <td className="py-2.5 pr-3">
                            <TicketDepartmentBadge department={r.department} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <TicketStatusBadge status={r.status} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className={`inline-flex items-center font-semibold rounded-full border px-2 py-0.5 text-[10px] ${PRIORITY_STYLE[r.priority]}`}>
                              {PRIORITY_LABEL[r.priority]}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-[#4A4A4A]">
                            {r.assignedStaffName ?? <span className="italic text-[#4A4A4A]/60">Unassigned</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-[#4A4A4A]/70">
                            {relativeTime(lastActivity)}
                          </td>
                          <td className="py-2.5">
                            <Link
                              href={`/staff/tickets/${r.id}`}
                              className="text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ul className="md:hidden space-y-2">
                {rows.map((r) => {
                  const lastActivity = r.lastStaffMessageAt ?? r.lastClientMessageAt ?? r.createdAt;
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/staff/tickets/${r.id}`}
                        className="block rounded-xl border border-gray-200 p-3 hover:border-[#F3CE49]/50 transition-colors"
                      >
                        <div className="font-semibold text-[#1E3A5F] mb-1 line-clamp-2">{r.subject}</div>
                        <div className="text-xs text-[#4A4A4A]/70 mb-2">
                          {r.clientName ?? 'unknown client'} · {r.messageCount} message{r.messageCount === 1 ? '' : 's'}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <TicketStatusBadge status={r.status} />
                          <TicketDepartmentBadge department={r.department} />
                          <span className={`inline-flex items-center font-semibold rounded-full border px-2 py-0.5 text-[10px] ${PRIORITY_STYLE[r.priority]}`}>
                            {PRIORITY_LABEL[r.priority]}
                          </span>
                        </div>
                        <div className="mt-1.5 text-xs text-[#4A4A4A]/60">
                          {r.assignedStaffName ?? 'Unassigned'} · {relativeTime(lastActivity)}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>

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
