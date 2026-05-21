'use client';

import { formatRelativeTime } from '@/lib/format-relative-time';
import type { CaseDetail } from './types';

// PR-CONSULT-2 — Overview tab.
//
// Static student-details panel + a tiny "case meta" panel. There
// are no actions on this tab in PR-CONSULT-2; the Reassign button
// lives on the assignments panel above the tab strip.

export function CaseOverviewTab({ data }: { data: CaseDetail }) {
  const fullName = `${data.student.firstName} ${data.student.lastName}`.trim() || '—';
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          Student
        </h3>
        <dl className="text-sm space-y-2.5">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Name</dt>
            <dd className="text-gray-900 font-medium text-right">{fullName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Email</dt>
            <dd className="text-gray-900 text-right break-all">{data.student.email}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Phone</dt>
            <dd className="text-gray-900 text-right">{data.student.phone ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Locale</dt>
            <dd className="text-gray-900 text-right uppercase">{data.student.locale}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          Case
        </h3>
        <dl className="text-sm space-y-2.5">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Status</dt>
            <dd className="text-gray-900 font-medium text-right">
              {data.status.replace(/_/g, ' ')}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Stage</dt>
            <dd className="text-gray-900 text-right">
              {data.stage.replace(/_/g, ' ')}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Created</dt>
            <dd className="text-gray-900 text-right">{formatRelativeTime(data.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Updated</dt>
            <dd className="text-gray-900 text-right">{formatRelativeTime(data.updatedAt)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
