'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, CheckCircle2, ArrowRight, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-SLA — the OWNER/ADMIN overdue report: overdue cases grouped by Client Officer,
// each clickable through to the case file. Read-only.

interface OverdueCase { caseId: string; clientName: string | null; stage: string; daysOverdue: number; deadline: string | null }
interface Officer { officerId: string | null; officerName: string; cases: OverdueCase[] }
interface Report { officers: Officer[]; totalOverdue: number }

const STAGE_LABEL: Record<string, string> = { ADMISSION: 'Admission', VISA: 'Visa', INZ_SUBMITTED: 'INZ submitted' };

export function SlaReportClient() {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<Report>('/staff/sla-report').then(setData).catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <AlertTriangle size={22} className="text-rose-500" />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Overdue cases</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Cases past their stage SLA, grouped by Client Officer. Deadlines follow the institution-type SLA settings.
        </p>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn’t load the report. Please refresh.</div>}
      {!data && !error && <Card><CardContent><div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div></CardContent></Card>}

      {data && data.totalOverdue === 0 && (
        <Card><CardContent>
          <div className="py-12 text-center">
            <CheckCircle2 size={30} className="mx-auto mb-2 text-[#c9a961]" />
            <p className="text-sm font-medium text-[#4A4A4A]">Nothing overdue</p>
            <p className="mt-1 text-xs text-gray-400">Every active case is within its stage SLA.</p>
          </div>
        </CardContent></Card>
      )}

      {data && data.totalOverdue > 0 && data.officers.map((o) => (
        <Card key={o.officerId ?? 'unassigned'}><CardContent>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[#1e3a5f]">
              <UserRound size={15} className="text-[#b8941f]" /> {o.officerName}
            </h2>
            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">{o.cases.length} overdue</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 px-3 font-semibold">Client</th>
                  <th className="py-2 px-3 font-semibold">Stage</th>
                  <th className="py-2 px-3 font-semibold">Overdue</th>
                  <th className="py-2 px-3 font-semibold w-0"></th>
                </tr>
              </thead>
              <tbody>
                {o.cases.map((c) => (
                  <tr key={c.caseId} className="border-b border-gray-50 hover:bg-[#faf8f3]">
                    <td className="py-2 px-3 font-medium text-[#1e3a5f]">{c.clientName ?? '—'}</td>
                    <td className="py-2 px-3 text-gray-500">{STAGE_LABEL[c.stage] ?? c.stage}</td>
                    <td className="py-2 px-3">
                      <span className="font-bold text-rose-600">{c.daysOverdue} day{c.daysOverdue === 1 ? '' : 's'}</span>
                    </td>
                    <td className="py-2 px-3">
                      <Link href={`/staff/cases/${c.caseId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1e3a5f] hover:underline whitespace-nowrap">
                        Case <ArrowRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}
