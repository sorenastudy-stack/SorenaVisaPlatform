'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, FileText, X, Search, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// OWNER audit-log browser. Read-only view over the existing AuditLog.
//   • table  → GET /admin/audit      (safe summaries, NO old/new values)
//   • drawer → GET /admin/audit/:id  (full old/new values — raw content lives
//              ONLY here, fetched on demand)
// Backend gates both to OWNER/SUPER_ADMIN. No action buttons anywhere.

interface AuditListItem {
  id: string;
  createdAt: string;
  action: string;
  eventType: string | null;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  actorName: string;
  actorRole: string | null;
  summary: string;
}
interface AuditListResult {
  items: AuditListItem[];
  nextCursor: { createdAt: string; id: string } | null;
}
interface AuditDetail extends AuditListItem {
  oldValue: unknown;
  newValue: unknown;
}

interface Filters {
  actorUserId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  dateFrom: string;
  dateTo: string;
}
const EMPTY_FILTERS: Filters = {
  actorUserId: '', entityType: '', entityId: '', eventType: '', dateFrom: '', dateTo: '',
};
const ENTITY_TYPES = ['CASE', 'LEAD', 'USER', 'PAYMENT', 'DOCUMENT', 'TICKET', 'MEETING', 'OFFICER', 'VISA'];

function buildQuery(f: Filters, cursor: { createdAt: string; id: string } | null): string {
  const p = new URLSearchParams();
  if (f.actorUserId.trim()) p.set('actorUserId', f.actorUserId.trim());
  if (f.entityType.trim()) p.set('entityType', f.entityType.trim());
  if (f.entityId.trim()) p.set('entityId', f.entityId.trim());
  if (f.eventType.trim()) p.set('eventType', f.eventType.trim());
  // date inputs are yyyy-mm-dd; widen to full-day ISO bounds.
  if (f.dateFrom) p.set('dateFrom', new Date(`${f.dateFrom}T00:00:00.000Z`).toISOString());
  if (f.dateTo) p.set('dateTo', new Date(`${f.dateTo}T23:59:59.999Z`).toISOString());
  if (cursor) { p.set('cursorCreatedAt', cursor.createdAt); p.set('cursorId', cursor.id); }
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

function RoleChip({ role }: { role: string | null }) {
  if (!role) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className="rounded-full border border-[#1E3A5F]/15 bg-[#1E3A5F]/5 px-2 py-0.5 text-[11px] font-semibold text-[#1E3A5F]">
      {role}
    </span>
  );
}

export default function AuditLogPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<AuditListItem[]>([]);
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  // Row-detail drawer.
  const [selected, setSelected] = useState<AuditDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchPage = useCallback(
    async (f: Filters, nextCursor: { createdAt: string; id: string } | null, append: boolean) => {
      append ? setLoadingMore(true) : setLoading(true);
      setError(false);
      try {
        const res = await api.get<AuditListResult>(`/admin/audit${buildQuery(f, nextCursor)}`);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
      } catch {
        setError(true);
      } finally {
        append ? setLoadingMore(false) : setLoading(false);
      }
    },
    [],
  );

  useEffect(() => { fetchPage(applied, null, false); }, [applied, fetchPage]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setSelected(null);
    try {
      const d = await api.get<AuditDetail>(`/admin/audit/${id}`);
      setSelected(d);
    } catch {
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-1">Audit Log</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-6">
        Immutable record of every system action. Showing the last 30 days unless a date filter is set.
      </p>

      {/* Filter bar */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A4A4A]/70">
              Actor user ID
              <input value={filters.actorUserId} onChange={(e) => setFilters({ ...filters, actorUserId: e.target.value })}
                placeholder="user id" className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#1E3A5F] focus:border-[#1E3A5F] focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A4A4A]/70">
              Entity type
              <input list="audit-entity-types" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
                placeholder="e.g. CASE" className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#1E3A5F] focus:border-[#1E3A5F] focus:outline-none" />
              <datalist id="audit-entity-types">{ENTITY_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A4A4A]/70">
              Entity ID
              <input value={filters.entityId} onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
                placeholder="entity id" className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#1E3A5F] focus:border-[#1E3A5F] focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A4A4A]/70">
              Event / action
              <input value={filters.eventType} onChange={(e) => setFilters({ ...filters, eventType: e.target.value })}
                placeholder="e.g. ISSUE_REFUND" className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#1E3A5F] focus:border-[#1E3A5F] focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A4A4A]/70">
              From
              <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#1E3A5F] focus:border-[#1E3A5F] focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#4A4A4A]/70">
              To
              <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#1E3A5F] focus:border-[#1E3A5F] focus:outline-none" />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setApplied({ ...filters })}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a] transition-colors">
              <Search size={14} /> Apply
            </button>
            <button onClick={() => { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-[#4A4A4A]/80 hover:bg-gray-50 transition-colors">
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn’t load the audit log. Please refresh.
        </div>
      )}

      {/* Table */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[#4A4A4A]/60">
              <Loader2 size={18} className="animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <FileText size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No audit entries for these filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 px-4 font-semibold">When</th>
                    <th className="py-3 px-4 font-semibold">Actor</th>
                    <th className="py-3 px-4 font-semibold">Event</th>
                    <th className="py-3 px-4 font-semibold">Entity</th>
                    <th className="py-3 px-4 font-semibold">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} onClick={() => openDetail(r.id)}
                      className="cursor-pointer border-b border-gray-50 hover:bg-[#faf8f3] transition-colors">
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap" title={new Date(r.createdAt).toISOString()}>
                        {formatRelativeTime(r.createdAt)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#1E3A5F]">{r.actorName}</span>
                          <RoleChip role={r.actorRole} />
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#4A4A4A]">
                        <span className="font-medium">{r.summary}</span>
                        <span className="ml-2 text-[11px] text-gray-400">{r.eventType ?? r.action}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
                        {r.entityType ?? '—'}{r.entityId ? <span className="text-gray-400"> · {r.entityId.slice(0, 8)}…</span> : null}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">{r.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keyset "load more" */}
      {!loading && cursor && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => fetchPage(applied, cursor, true)} disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-[#1E3A5F] hover:bg-gray-50 disabled:opacity-50 transition-colors">
            {loadingMore ? <><Loader2 size={15} className="animate-spin" /> Loading…</> : 'Load more'}
          </button>
        </div>
      )}

      {/* Row-detail drawer */}
      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelected(null)} />
          <aside className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-sm font-bold text-[#1E3A5F]">Audit entry</h2>
              <button onClick={() => setSelected(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {detailLoading || !selected ? (
                <div className="flex items-center justify-center gap-2 py-16 text-[#4A4A4A]/60">
                  <Loader2 size={18} className="animate-spin" /> Loading…
                </div>
              ) : (
                <dl className="space-y-3 text-sm">
                  <Field label="Event">{selected.summary}</Field>
                  <Field label="Event type">{selected.eventType ?? selected.action}</Field>
                  <Field label="When">{new Date(selected.createdAt).toLocaleString()} <span className="text-gray-400">({formatRelativeTime(selected.createdAt)})</span></Field>
                  <Field label="Actor">{selected.actorName} <RoleChip role={selected.actorRole} /></Field>
                  <Field label="Entity">{selected.entityType ?? '—'}{selected.entityId ? ` · ${selected.entityId}` : ''}</Field>
                  <Field label="IP address">{selected.ipAddress ?? '—'}</Field>
                  <JsonField label="Old value" value={selected.oldValue} />
                  <JsonField label="New value" value={selected.newValue} />
                </dl>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-[#1E3A5F]">{children}</dd>
    </div>
  );
}

function JsonField({ label, value }: { label: string; value: unknown }) {
  const isEmpty = value === null || value === undefined;
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-1">
        {isEmpty ? (
          <span className="text-sm text-gray-400">—</span>
        ) : (
          <pre className="overflow-x-auto rounded-lg bg-[#1E3A5F]/5 p-3 text-xs text-[#1E3A5F]">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </dd>
    </div>
  );
}
