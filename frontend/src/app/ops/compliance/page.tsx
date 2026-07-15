'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// OPS Compliance — contract exceptions monitor. Surfaces ACTIVE cases whose
// engagement contract is a compliance exception (advanced to a visa stage
// unsigned, or an envelope started but never completed). Read-only: each row
// links to the case for an admin to act. Mirrors /ops/handoffs structurally.
// English-only surface (Persian is frozen — no next-intl on this page).

type Reason = 'contract_missing' | 'contract_unsigned' | 'contract_stalled' | 'contract_declined';

interface ComplianceRow {
  caseId: string;
  clientName: string | null;
  stage: string;
  reason: Reason;
  since: string | null;
}
interface NonCompliantResponse {
  rows: ComplianceRow[];
}

// Human microcopy — never surface raw reason codes.
const ISSUE_LABEL: Record<Reason, string> = {
  contract_missing:  'No contract on file',
  contract_unsigned: 'Contract never signed',
  contract_stalled:  'Contract sent but not signed',
  contract_declined: 'Client declined the contract',
};

const STAGE_LABEL: Record<string, string> = {
  ADMISSION: 'Admission',
  VISA: 'Visa',
  INZ_SUBMITTED: 'INZ submitted',
};

export default function OpsCompliancePage() {
  const [rows, setRows] = useState<ComplianceRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get<NonCompliantResponse>('/ops/compliance/non-compliant')
      .then((d) => setRows(d.rows))
      .catch(() => setError(true));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-1">Compliance</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">
        Active cases whose contract needs attention — longest-waiting first.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn’t load the compliance list. Please refresh.
        </div>
      )}

      {/* Loading */}
      {!rows && !error && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-[#4A4A4A]/60">
            <Loader2 size={18} className="animate-spin" /> Loading…
          </CardContent>
        </Card>
      )}

      {/* Empty — warm, not clinical */}
      {rows && rows.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <ShieldCheck size={32} className="mx-auto text-[#c9a961] mb-3" />
            <p className="text-[#4A4A4A] font-medium">Every active case is in good standing</p>
            <p className="text-sm text-[#4A4A4A]/60 mt-1">
              No contract issues need your attention right now.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Worklist */}
      {rows && rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 px-4 font-semibold">Client</th>
                    <th className="py-3 px-4 font-semibold">Stage</th>
                    <th className="py-3 px-4 font-semibold">Issue</th>
                    <th className="py-3 px-4 font-semibold">Waiting</th>
                    <th className="py-3 px-4 font-semibold w-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.caseId} className="border-b border-gray-50 hover:bg-[#faf8f3] transition-colors">
                      <td className="py-3 px-4 font-medium text-[#1e3a5f]">{r.clientName ?? '—'}</td>
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
                        {STAGE_LABEL[r.stage] ?? r.stage}
                      </td>
                      <td className="py-3 px-4">
                        <span className="rounded-full border border-[#c9a961]/40 bg-[#c9a961]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">
                          {ISSUE_LABEL[r.reason]}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">
                        {r.since ? formatRelativeTime(r.since) : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          href={`/ops/cases/${r.caseId}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] transition-colors whitespace-nowrap min-h-[48px]"
                        >
                          Open case <ArrowRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
