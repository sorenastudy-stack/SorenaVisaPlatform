'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// OPS Handoffs — exceptions monitor. Surfaces cases where a specialist slot is
// empty AND already past the point auto-assignment should have filled it (the
// server decides "due"). Read-only: each row links to the case for an admin to
// staff it via the existing reassign endpoints.

type Slot = 'CONSULTANT' | 'LIA' | 'ADMISSION' | 'FINANCE' | 'PASTORAL';

interface MissingSlot {
  slot: Slot;
  dueSince: string;
  reason: string | null;
  attemptAt: string | null;
}
interface HandoffRow {
  caseId: string;
  clientName: string | null;
  stage: string;
  missingSlots: MissingSlot[];
  wrongRoleOwner: boolean;
  waitingSinceEarliest: string | null;
}
interface PendingHandoffs {
  consultantPoolEmpty: boolean;
  unstaffedConsultantCount: number;
  rows: HandoffRow[];
}

const SLOT_LABEL: Record<Slot, string> = {
  CONSULTANT: 'Client Officer',
  LIA: 'LIA',
  ADMISSION: 'Admission Officer',
  FINANCE: 'Finance',
  PASTORAL: 'Pastoral Care',
};

// 'no_active_finance_staff' → 'No active finance staff'
function humanizeReason(reason: string | null): string {
  if (!reason) return '—';
  const s = reason.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function OpsHandoffsPage() {
  const [data, setData] = useState<PendingHandoffs | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<PendingHandoffs>('/ops/handoffs/pending').then(setData).catch(() => setError(true));
  }, []);

  const rows = data?.rows ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-1">Handoffs</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Cases where a specialist slot is due but unstaffed — oldest first.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn’t load the handoffs queue. Please refresh.
        </div>
      )}

      {/* Consultant pool banner — only when no Client Officers are configured */}
      {data?.consultantPoolEmpty && data.unstaffedConsultantCount > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              No Client Officers configured — {data.unstaffedConsultantCount}{' '}
              {data.unstaffedConsultantCount === 1 ? 'case is' : 'cases are'} unstaffed
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              Every eligible case is missing its consultant. Create a Client Officer so
              auto-assignment can staff them.
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {!data && !error && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-[#4A4A4A]/60">
            <Loader2 size={18} className="animate-spin" /> Loading…
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {data && rows.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 size={32} className="mx-auto text-sorena-jade/50 mb-3" />
            <p className="text-[#4A4A4A] font-medium">No stuck handoffs — every due slot is staffed.</p>
          </CardContent>
        </Card>
      )}

      {/* Worklist */}
      {data && rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 px-4 font-semibold">Client</th>
                    <th className="py-3 px-4 font-semibold">Stage</th>
                    <th className="py-3 px-4 font-semibold">Missing role(s)</th>
                    <th className="py-3 px-4 font-semibold">Waiting</th>
                    <th className="py-3 px-4 font-semibold">Reason</th>
                    <th className="py-3 px-4 font-semibold w-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const reasons = Array.from(
                      new Set(r.missingSlots.map((m) => humanizeReason(m.reason)).filter((x) => x !== '—')),
                    );
                    return (
                      <tr key={r.caseId} className="border-b border-gray-50 hover:bg-[#faf8f3] transition-colors">
                        <td className="py-3 px-4 font-medium text-[#1E3A5F]">{r.clientName ?? '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">{r.stage}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1.5">
                            {r.missingSlots.map((m) => (
                              <span
                                key={m.slot}
                                className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700"
                              >
                                {SLOT_LABEL[m.slot]}
                              </span>
                            ))}
                            {r.wrongRoleOwner && (
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                Wrong-role owner
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
                          {r.waitingSinceEarliest ? formatRelativeTime(r.waitingSinceEarliest) : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs text-[#4A4A4A]/80">
                          {reasons.length > 0 ? reasons.join(', ') : '—'}
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/ops/cases/${r.caseId}`}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] transition-colors whitespace-nowrap"
                          >
                            Open case <ArrowRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
