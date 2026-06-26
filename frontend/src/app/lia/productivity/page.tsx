import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BarChart3, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { getSession } from '@/lib/auth';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { formatRelative, openCasesStyles } from '../_utils/format';

// PR-LIA-3 — LIA productivity report.
//
// Layered role gating:
//   * Middleware allows LIA / OWNER / ADMIN / SUPER_ADMIN onto /lia/*.
//   * Layout (frontend/src/app/lia/layout.tsx) re-checks the same set.
//   * THIS page additionally restricts to OWNER / ADMIN / SUPER_ADMIN.
//     LIA users land here only via a typed URL; we redirect them back
//     to /lia (the LIA dashboard) — no error page, no peek at the
//     peer-comparison metrics that are intentionally private.
//   * Backend GET /staff/lia-productivity is also gated to
//     OWNER / ADMIN / SUPER_ADMIN — the frontend gate is UX-only.

interface LiaProductivityRow {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  openCases: number;
  totalAssigned: number;
  avgDaysToFirstAction: number | null;
  avgDaysToResolution: number | null;
  decisionsThisMonth: number;
  avgClientResponseHours: number | null;
}

interface ProductivityResponse {
  rows: LiaProductivityRow[];
  generatedAt: string;
}

export default async function LiaProductivityPage() {
  const session = await getSession();
  if (!session || !['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(session.role)) {
    redirect('/lia');
  }

  let data: ProductivityResponse | null = null;
  let errorMsg: string | null = null;
  try {
    data = await apiServer.get<ProductivityResponse>('/staff/lia-productivity');
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load productivity report.';
  }

  return (
    <div className="max-w-7xl">
      <BackLink href="/lia" label="Back to dashboard" />
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <BarChart3 size={22} className="text-[#b8941f]" />
            LIA Productivity
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Per-LIA performance metrics. Visible to OWNER / ADMIN / SUPER_ADMIN only.
          </p>
        </div>
        {data?.generatedAt && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#FAF8F3] text-[#4A4A4A] border border-gray-200">
            Generated {formatRelative(data.generatedAt)}
          </span>
        )}
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      {data && data.rows.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Users size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
            <p className="text-[#4A4A4A] font-medium">No active LIAs yet</p>
            <p className="text-sm text-[#4A4A4A]/60 mt-1 mb-4">
              Add at least one user with role <strong>LIA</strong> to start tracking productivity.
            </p>
            <Link
              href="/staff/users"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#1E3A5F] hover:text-[#b8941f]"
            >
              Go to Staff Users →
            </Link>
          </CardContent>
        </Card>
      )}

      {data && data.rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#FAF8F3] text-[#4A4A4A]/70 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">LIA</th>
                    <th className="px-4 py-3 text-right">Open cases</th>
                    <th className="px-4 py-3 text-right">Total assigned</th>
                    <th className="px-4 py-3 text-right">Avg days · first action</th>
                    <th className="px-4 py-3 text-right">Avg days · resolution</th>
                    <th className="px-4 py-3 text-right">Decisions · this month</th>
                    <th className="px-4 py-3 text-right">Avg client response (h)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAF8F3]">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#1E3A5F]">
                          {r.name}
                          {!r.isActive && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                              Archived
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#4A4A4A]/60 mt-0.5">{r.email}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold ${openCasesStyles(r.openCases)}`}>
                          {r.openCases}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#1E3A5F]">{r.totalAssigned}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#4A4A4A]">{formatNumber(r.avgDaysToFirstAction)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#4A4A4A]">{formatNumber(r.avgDaysToResolution)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#1E3A5F]">{r.decisionsThisMonth}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#4A4A4A]">{formatNumber(r.avgClientResponseHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked cards */}
            <ul className="md:hidden divide-y divide-gray-100">
              {data.rows.map((r) => (
                <li key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[#1E3A5F] truncate">
                        {r.name}
                        {!r.isActive && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                            Archived
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#4A4A4A]/60 truncate">{r.email}</div>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold ${openCasesStyles(r.openCases)} tabular-nums flex-shrink-0`}>
                      {r.openCases} open
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <Metric label="Total assigned" value={String(r.totalAssigned)} />
                    <Metric label="Decisions / mo" value={String(r.decisionsThisMonth)} />
                    <Metric label="Avg days · first action" value={formatNumber(r.avgDaysToFirstAction)} />
                    <Metric label="Avg days · resolution" value={formatNumber(r.avgDaysToResolution)} />
                    <Metric label="Avg client response (h)" value={formatNumber(r.avgClientResponseHours)} />
                  </dl>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-[#4A4A4A]/60 mt-4">
        Open-cases colour bands: 0 = emerald · 1–3 = blue · 4–7 = amber · 8+ = red.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#FAF8F3] rounded-lg px-2.5 py-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-[#4A4A4A]/60">{label}</dt>
      <dd className="text-sm font-semibold text-[#1E3A5F] tabular-nums">{value}</dd>
    </div>
  );
}

function formatNumber(n: number | null): string {
  return n === null ? '—' : String(n);
}
