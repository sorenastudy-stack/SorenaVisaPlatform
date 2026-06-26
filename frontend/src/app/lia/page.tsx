import Link from 'next/link';
import { AlertTriangle, ShieldAlert, FileSearch, Briefcase, ArrowRight, CheckCircle2, UserCheck, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { getSession } from '@/lib/auth';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { riskStyles, riskLabel, stageStyles, stageLabel, formatRelative, isEscalatedRisk } from './_utils/format';

// PR-LIA-9: expiring-soon queue row shape used by the dashboard card.
// Single field needed here is the visa id (for the count) — full
// shape is consumed by the dedicated page.
interface ExpiringSoonRow {
  visaId: string;
}

// PR-LIA-1 — LIA dashboard. Live data from GET /cases.

interface CaseRow {
  id: string;
  stage: string;
  status: string;
  riskLevel: string;
  notes: string | null;
  ownerId: string | null;
  // PR-LIA-2: assigned LIA — used for the "Assigned to me" stat.
  liaId: string | null;
  createdAt: string;
  updatedAt: string;
  lead: {
    id: string;
    hardStopFlag: boolean;
    hardStopReason: string | null;
    contact: { id: string; fullName: string | null; email: string | null } | null;
  };
  owner: { id: string; name: string } | null;
  lia: { id: string; name: string } | null;
}

export default async function LiaDashboardPage() {
  const session = await getSession();

  let cases: CaseRow[] = [];
  let expiringSoon: ExpiringSoonRow[] = [];
  let errorMsg: string | null = null;

  try {
    cases = await apiServer.get<CaseRow[]>('/cases');
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load cases.';
  }
  // PR-LIA-9: count visas expiring in the next 30 days. Non-fatal — if
  // the endpoint errors the card just renders zero.
  try {
    expiringSoon = await apiServer.get<ExpiringSoonRow[]>(
      '/staff/visa-expiry/expiring-soon?thresholdDays=30',
    );
  } catch {
    expiringSoon = [];
  }

  const total = cases.length;
  const blocked = cases.filter(c => c.riskLevel === 'BLOCKED' || c.lead?.hardStopFlag).length;
  const high = cases.filter(c => c.riskLevel === 'HIGH').length;
  const needsReview = cases.filter(c => isEscalatedRisk(c.riskLevel) || c.lead?.hardStopFlag).length;
  const active = cases.filter(c => c.stage !== 'COMPLETED' && c.stage !== 'WITHDRAWN').length;
  // PR-LIA-2: count open cases where the viewer is the assigned LIA.
  const myId = session?.userId ?? '';
  const assignedToMe = cases.filter(
    c => c.liaId === myId && c.stage !== 'COMPLETED' && c.stage !== 'WITHDRAWN',
  ).length;

  const recentEscalations = cases
    .filter(c => isEscalatedRisk(c.riskLevel) || c.lead?.hardStopFlag)
    .slice(0, 5);

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E3A5F]">
          Welcome back, {session?.name?.split(' ')[0] ?? 'there'}
        </h1>
        <p className="text-sm text-[#4A4A4A]/70 mt-1">LIA dashboard — legal &amp; immigration review</p>
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard href="/lia/cases?risk=escalated" label="Needs Review" value={needsReview} icon={<FileSearch size={20} />} tone="amber" />
        <StatCard href="/lia/cases?risk=blocked" label="Blocked" value={blocked} icon={<ShieldAlert size={20} />} tone="red" />
        <StatCard href="/lia/cases?risk=high" label="High Risk" value={high} icon={<AlertTriangle size={20} />} tone="orange" />
        <StatCard href="/lia/cases" label="Active Cases" value={active} icon={<Briefcase size={20} />} tone="navy" />
        <StatCard href="/lia/cases?assignment=mine" label="Assigned to me" value={assignedToMe} icon={<UserCheck size={20} />} tone="gold" />
        <StatCard
          href="/lia/expiring-soon"
          label="Expiring soon"
          value={expiringSoon.length}
          icon={<Clock size={20} />}
          tone={expiringSoon.length > 0 ? 'amber' : 'navy'}
        />
      </div>

      <Card className="mb-8">
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#1E3A5F]">Recent escalations</h2>
            {recentEscalations.length > 0 && (
              <Link href="/lia/cases?risk=escalated" className="text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]">
                View all →
              </Link>
            )}
          </div>

          {recentEscalations.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-3" />
              <p className="text-[#4A4A4A] font-medium">All caught up</p>
              <p className="text-sm text-[#4A4A4A]/60 mt-1">No escalated cases right now.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentEscalations.map(c => (
                <li key={c.id} className="py-3">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[#1E3A5F] truncate">
                          {c.lead?.contact?.fullName ?? 'Unknown applicant'}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${stageStyles(c.stage)}`}>
                          {stageLabel(c.stage)}
                        </span>
                      </div>
                      <div className="text-xs text-[#4A4A4A]/70 mt-0.5">
                        Case {c.id.slice(0, 8)} · escalated {formatRelative(c.createdAt)}
                        {c.lead?.hardStopFlag && ' · hard stop'}
                      </div>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold ${riskStyles(c.riskLevel)}`}>
                      {riskLabel(c.riskLevel)}
                    </span>
                    <Link href={`/lia/cases/${c.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]">
                      Review <ArrowRight size={14} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardContent>
          <h2 className="text-lg font-bold text-[#1E3A5F] mb-4">Case totals</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <BreakdownTile label="Total cases" value={total} tone="gray" />
            <BreakdownTile label="Active" value={active} tone="blue" />
            <BreakdownTile label="High risk" value={high} tone="amber" />
            <BreakdownTile label="Blocked" value={blocked} tone="red" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <QuickLink href="/lia/cases" label="All cases" />
        <QuickLink href="/lia/decisions" label="Decisions log" />
        <QuickLink href="/lia/documents" label="Documents under review" />
      </div>
    </div>
  );
}

function StatCard({ href, label, value, icon, tone }: {
  href: string; label: string; value: number; icon: React.ReactNode;
  tone: 'red' | 'amber' | 'orange' | 'navy' | 'gold';
}) {
  const tones = {
    red: 'text-[#C0392B] bg-red-50',
    amber: 'text-[#D97706] bg-amber-50',
    orange: 'text-orange-700 bg-orange-50',
    navy: 'text-[#1E3A5F] bg-[#1E3A5F]/10',
    gold: 'text-[#1E3A5F] bg-[#F3CE49]/20',
  };
  return (
    <Link href={href} className="block rounded-xl border border-gray-100 bg-white p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="text-3xl font-bold text-[#1E3A5F]">{value}</div>
      <div className="text-sm text-[#4A4A4A]/70 mt-1">{label}</div>
    </Link>
  );
}

function BreakdownTile({ label, value, tone }: {
  label: string; value: number; tone: 'gray' | 'blue' | 'amber' | 'red';
}) {
  const tones = {
    gray:  'bg-gray-50 text-gray-700',
    blue:  'bg-blue-50 text-blue-800',
    amber: 'bg-amber-50 text-amber-800',
    red:   'bg-red-50 text-red-800',
  };
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium mt-0.5">{label}</div>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4 hover:border-[#F3CE49] hover:shadow-sm transition-all">
      <span className="text-sm font-semibold text-[#1E3A5F]">{label}</span>
      <ArrowRight size={16} className="text-[#1E3A5F]/50" />
    </Link>
  );
}
