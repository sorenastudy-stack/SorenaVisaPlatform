'use client';

import { useEffect, useState } from 'react';
import { CasesPageHeader } from './CasesPageHeader';
import { CasesTable } from './CasesTable';
import { CasesGrid } from './CasesGrid';
import { CasesPagination } from './CasesPagination';
import { useCasesQuery } from './useCasesQuery';

// PR-CONSULT-2 — Cases list page (client component).
//
// Hoists filter / pagination state, persists the view-mode in
// localStorage, and feeds the query into useCasesQuery. The
// view-mode default branches on viewport: `card` on small screens,
// `table` on larger ones — but once the user picks a mode it sticks
// for that browser.

const VIEW_MODE_KEY = 'sorena.staff.casesViewMode';

function defaultViewMode(): 'table' | 'card' {
  if (typeof window === 'undefined') return 'table';
  const stored = window.localStorage.getItem(VIEW_MODE_KEY);
  if (stored === 'table' || stored === 'card') return stored;
  return window.matchMedia('(min-width: 1024px)').matches ? 'table' : 'card';
}

export function CasesPageClient() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');

  // Initialise view mode once the window is available.
  useEffect(() => {
    setViewMode(defaultViewMode());
  }, []);

  const handleViewModeChange = (v: 'table' | 'card') => {
    setViewMode(v);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, v);
    } catch {
      // localStorage may be blocked (e.g. private browsing). The
      // component still works in-memory for this session.
    }
  };

  // Reset to page 1 whenever a filter changes — otherwise the user
  // can end up viewing "page 4" of a 2-page result set.
  useEffect(() => {
    setPage(1);
  }, [search, status, assignedToMe]);

  const { data, loading, error } = useCasesQuery({
    q:            search,
    status,
    assignedToMe,
    page,
    pageSize:     20,
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <CasesPageHeader
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
        assignedToMe={assignedToMe}
        onAssignedToMeChange={setAssignedToMe}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
          Loading cases…
        </div>
      ) : viewMode === 'table' ? (
        <CasesTable items={data?.items ?? []} />
      ) : (
        <CasesGrid items={data?.items ?? []} />
      )}

      {data && (
        <CasesPagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
