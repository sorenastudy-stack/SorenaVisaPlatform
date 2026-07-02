import Link from 'next/link';
import { Briefcase, AlertTriangle, Clock, ChevronRight } from 'lucide-react';
import { getSession } from '@/lib/auth';
import { apiServer } from '@/lib/apiServer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-OPS-DASHBOARD — the OPERATIONS home. Three sections, all from existing
// data (see GET /api/staff/cases/dashboard): active-case counts by stage,
// a needs-action worklist, and a cross-case recent-activity slice. Each item
// links into /ops/cases (filtered) or /ops/cases/:id.

interface DashboardData {
  countsByStage: { stage: string; count: number }[];
  worklist: { caseId: string; clientName: string; stage: string; reasons: string[] }[];
  recentActivity: {
    id: string; caseId: string; clientName: string;
    actorName: string | null; actorRole: string | null;
    createdAt: string; summary: string;
  }[];
}

const STAGE_LABEL: Record<string, string> = {
  ADMISSION: 'Admission', VISA: 'Visa', INZ_SUBMITTED: 'INZ submitted',
  COMPLETED: 'Completed', WITHDRAWN: 'Withdrawn',
};

const REASON: Record<string, { label: string; cls: string }> = {
  HARD_STOP:  { label: 'Blocked',    cls: 'bg-red-50 text-red-700 border-red-200' },
  HIGH_RISK:  { label: 'High risk',  cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  ESCALATION: { label: 'Escalation', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  UNASSIGNED: { label: 'Unassigned', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

export default async function OpsDashboard() {
  const session = await getSession();

  let data: DashboardData = { countsByStage: [], worklist: [], recentActivity: [] };
  let failed = false;
  try {
    data = await apiServer.get<DashboardData>('/api/staff/cases/dashboard');
  } catch {
    failed = true;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#1e3a5f] mb-1">
          Welcome back, {session?.name || 'there'}
        </h1>
        <p className="text-sm text-gray-400">Operations Dashboard</p>
      </div>

      {failed && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn’t load the dashboard. Please refresh.
        </div>
      )}

      {/* ── Active cases by stage ─────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">Active cases</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {data.countsByStage.map((c) => (
            <Link key={c.stage} href={`/ops/cases?stage=${c.stage}`} className="block">
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm text-gray-500">
                    <Briefcase size={16} className="text-[#b8941f]" />
                    {STAGE_LABEL[c.stage] ?? c.stage}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-[#1e3a5f]">{c.count}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                    View cases <ChevronRight size={12} />
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Worklist ──────────────────────────────────────────────── */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          <AlertTriangle size={15} className="text-orange-500" /> Needs attention
        </h2>
        <Card>
          <CardContent className="p-0">
            {data.worklist.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">Nothing needs attention right now.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.worklist.map((w) => (
                  <li key={w.caseId}>
                    <Link href={`/ops/cases/${w.caseId}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#faf8f3] transition-colors">
                      <div className="min-w-0">
                        <div className="font-medium text-[#1e3a5f] truncate">{w.clientName}</div>
                        <div className="text-xs text-gray-400">{STAGE_LABEL[w.stage] ?? w.stage}</div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {w.reasons.map((r) => {
                          const cfg = REASON[r] ?? { label: r, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
                          return (
                            <span key={r} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
                              {cfg.label}
                            </span>
                          );
                        })}
                        <ChevronRight size={14} className="text-gray-300" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Recent activity ───────────────────────────────────────── */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">
          <Clock size={15} className="text-gray-400" /> Recent activity
        </h2>
        <Card>
          <CardContent className="p-0">
            {data.recentActivity.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">No recent case activity.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.recentActivity.map((a) => (
                  <li key={a.id}>
                    <Link href={`/ops/cases/${a.caseId}`} className="block px-4 py-3 hover:bg-[#faf8f3] transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-gray-700">{a.summary}</p>
                        <span className="shrink-0 text-xs text-gray-400">{formatRelativeTime(a.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {a.clientName}{a.actorName ? ` · ${a.actorName}` : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
