import Link from 'next/link';
import { Clock, ArrowRight, Search, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { getSession } from '@/lib/auth';
import { formatDate, formatRelative } from '../_utils/format';
import { RunReminderSweepButton } from './RunReminderSweepButton';

// PR-LIA-9 — Visas expiring within the chosen window.
//
// Server component. Filter chip drives the `thresholdDays` query
// param; default 90 (wide window so the page is useful), but the
// chip row also offers 30 / 14 / 7. Rows sorted by daysRemaining ASC.

interface ExpiringRow {
  visaId: string;
  caseId: string;
  applicantName: string | null;
  applicantEmail: string | null;
  visaStartDate: string | null;
  visaEndDate: string | null;
  daysRemaining: number | null;
  liaId: string | null;
  liaName: string | null;
  liaEmail: string | null;
  remindersSent: {
    thirtyDay: boolean;
    fourteenDay: boolean;
    sevenDay: boolean;
  };
}

type SearchParams = {
  thresholdDays?: string;
};

export default async function ExpiringSoonPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  const canTriggerSweep = !!session && ['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(session.role);

  const t = searchParams.thresholdDays ?? '90';
  const validThresholds = ['7', '14', '30', '90'];
  const threshold = validThresholds.includes(t) ? t : '90';

  let rows: ExpiringRow[] = [];
  let errorMsg: string | null = null;
  try {
    rows = await apiServer.get<ExpiringRow[]>(
      `/staff/visa-expiry/expiring-soon?thresholdDays=${threshold}`,
    );
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load expiring visas.';
  }

  // Already sorted server-side, but ensure stable null handling.
  rows = [...rows].sort((a, b) => {
    if (a.daysRemaining === null) return 1;
    if (b.daysRemaining === null) return -1;
    return a.daysRemaining - b.daysRemaining;
  });

  return (
    <div className="max-w-7xl">
      <BackLink href="/lia" label="Back to dashboard" />

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Clock size={22} className="text-[#b8941f]" />
            Expiring Soon
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Approved visas expiring within the selected window. Reminders fire automatically at 30 / 14 / 7-day thresholds.
          </p>
        </div>
        {canTriggerSweep && (
          <RunReminderSweepButton candidateCount={rows.length} />
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-xs font-semibold text-[#4A4A4A]/70 w-24 flex-shrink-0">Threshold</span>
        {(['7', '14', '30', '90'] as const).map((value) => (
          <Link
            key={value}
            href={`/lia/expiring-soon?thresholdDays=${value}`}
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              threshold === value
                ? 'bg-[#1E3A5F] text-white'
                : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
            }`}
          >
            {value} days
          </Link>
        ))}
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-3" />
              <p className="text-[#4A4A4A] font-medium">No visas expiring in this window</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">
                Nothing in the next {threshold} days. Try widening the window if you'd like to see further ahead.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-left">Applicant</th>
                      <th className="px-4 py-3 text-left">Visa end</th>
                      <th className="px-4 py-3 text-left">Days remaining</th>
                      <th className="px-4 py-3 text-left">LIA</th>
                      <th className="px-4 py-3 text-left">Reminders sent</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((r) => (
                      <tr key={r.visaId} className="hover:bg-[#FAF8F3]">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#1E3A5F]">{r.applicantName ?? 'Unknown'}</div>
                          <div className="text-xs text-[#4A4A4A]/60 mt-0.5">Case {r.caseId.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-3 text-[#4A4A4A]">
                          {r.visaEndDate ? formatDate(r.visaEndDate) : '—'}
                          {r.visaEndDate && (
                            <div className="text-xs text-[#4A4A4A]/60">{formatRelative(r.visaEndDate)}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <DaysRemainingBadge days={r.daysRemaining} />
                        </td>
                        <td className="px-4 py-3 text-[#4A4A4A]">
                          {r.liaName ?? <span className="text-[#4A4A4A]/50 italic">Unassigned</span>}
                        </td>
                        <td className="px-4 py-3">
                          <ReminderPills sent={r.remindersSent} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/lia/cases/${r.caseId}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]">
                            Open <ArrowRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="md:hidden divide-y divide-gray-100">
                {rows.map((r) => (
                  <li key={r.visaId} className="p-4 hover:bg-[#FAF8F3]">
                    <Link href={`/lia/cases/${r.caseId}`} className="block">
                      <div className="flex items-start gap-2 mb-1">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-[#1E3A5F]">{r.applicantName ?? 'Unknown'}</div>
                          <div className="text-xs text-[#4A4A4A]/60 mt-0.5">Case {r.caseId.slice(0, 8)}</div>
                        </div>
                        <DaysRemainingBadge days={r.daysRemaining} />
                      </div>
                      <div className="text-xs text-[#4A4A4A]/60 mb-2">
                        {r.visaEndDate ? `Expires ${formatDate(r.visaEndDate)}` : 'No end date'}
                        {r.liaName && ` · LIA: ${r.liaName}`}
                      </div>
                      <ReminderPills sent={r.remindersSent} />
                    </Link>
                  </li>
                ))}
              </ul>

              <p className="text-xs text-[#4A4A4A]/60 px-4 py-3 border-t border-gray-100">
                Reminders fire at 09:00 NZ time daily via the visaExpiryDailySweep cron. Each (visa, threshold, recipient) combo is dispatched once and never re-sent — the unique constraint enforces idempotency.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DaysRemainingBadge({ days }: { days: number | null }) {
  if (days === null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
        —
      </span>
    );
  }
  let tone: string;
  let label: string;
  if (days < 0) {
    tone = 'bg-red-800 text-white border border-red-900';
    label = `Expired ${Math.abs(days)}d ago`;
  } else if (days < 7) {
    tone = 'bg-red-100 text-red-800 border border-red-200';
    label = `${days}d remaining`;
  } else if (days < 14) {
    tone = 'bg-orange-100 text-orange-800 border border-orange-200';
    label = `${days}d remaining`;
  } else if (days <= 30) {
    tone = 'bg-amber-100 text-amber-800 border border-amber-200';
    label = `${days}d remaining`;
  } else {
    tone = 'bg-blue-50 text-blue-800 border border-blue-200';
    label = `${days}d remaining`;
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold ${tone}`}>
      {label}
    </span>
  );
}

function ReminderPills({
  sent,
}: {
  sent: { thirtyDay: boolean; fourteenDay: boolean; sevenDay: boolean };
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <Pill label="30d" filled={sent.thirtyDay} />
      <Pill label="14d" filled={sent.fourteenDay} />
      <Pill label="7d"  filled={sent.sevenDay} />
    </div>
  );
}

function Pill({ label, filled }: { label: string; filled: boolean }) {
  return (
    <span
      className={
        filled
          ? 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200'
          : 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-[#4A4A4A]/50 border border-dashed border-gray-300'
      }
    >
      {label}
    </span>
  );
}
