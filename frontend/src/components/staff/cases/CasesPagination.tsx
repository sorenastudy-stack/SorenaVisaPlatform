'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

// PR-CONSULT-2 — Pagination control.
//
// Prev / Next + "Page N of M" indicator. We deliberately keep this
// simple (no page-number jump bar) because page count rarely
// exceeds a handful for staff workloads.

export function CasesPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page:         number;
  pageSize:     number;
  total:        number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-3 text-sm text-gray-600">
      <span>
        Page {page} of {pages}
      </span>
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px]"
      >
        <ChevronLeft size={16} />
        Prev
      </button>
      <button
        onClick={() => onPageChange(Math.min(pages, page + 1))}
        disabled={page >= pages}
        className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px]"
      >
        Next
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
