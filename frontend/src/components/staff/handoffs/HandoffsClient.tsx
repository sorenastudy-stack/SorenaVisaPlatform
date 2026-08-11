'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight, Users, AlertTriangle, UserX, PauseCircle,
  ArrowRight, Loader2, CheckCircle2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-HANDOFFS — Owner-dashboard Handoffs section (Definition A: staffing handoff).
// Composes two read-only surfaces from GET /api/staff/handoffs:
//   1. Unstaffed roles (reuse)  — the /ops/handoffs "due but empty / wrong-role"
//      staffing exceptions, cross-case.
//   2. Stuck cases (NEW)        — three progression stalls derived from existing
//      state (signed+paid still in Admission; visa approved w/o pastoral;
//      INZ_SUBMITTED aged). No new tracking.
// The full stage-transition history (Option 2) is deferred — see the backlog note.

type Slot = 'CONSULTANT' | 'LIA' | 'ADMISSION' | 'FINANCE' | 'PASTORAL';
type StuckRule = 'SIGNED_PAID_STUCK_ADMISSION' | 'VISA_APPROVED_NO_PASTORAL' | 'INZ_SUBMITTED_AGED';

interface MissingSlot { slot: Slot; dueSince: string; reason: string | null; attemptAt: string | null; }
interface HandoffRow {
  caseId: string; clientName: string | null; stage: string;
  missingSlots: MissingSlot[]; wrongRoleOwner: boolean; waitingSinceEarliest: string | null;
}
interface StaffingResponse {
  consultantPoolEmpty: boolean; unstaffedConsultantCount: number; rows: HandoffRow[];
}
interface StuckRow {
  caseId: string; clientName: string | null; stage: string;
  rule: StuckRule; detail: string; waitingSince: string | null;
}
interface HandoffsResponse { staffing: StaffingResponse; stuck: StuckRow[]; inzAgeThresholdDays: number; }

const SLOT_LABEL: Record<Slot, string> = {
  CONSULTANT: 'Client Officer', LIA: 'LIA', ADMISSION: 'Admission Officer',
  FINANCE: 'Finance', PASTORAL: 'Pastoral Care',
};
const STAGE_LABEL: Record<string, string> = {
  ADMISSION: 'Admission', VISA: 'Visa', INZ_SUBMITTED: 'INZ submitted',
  COMPLETED: 'Completed', WITHDRAWN: 'Withdrawn',
};
const RULE_LABEL: Record<StuckRule, string> = {
  SIGNED_PAID_STUCK_ADMISSION: 'Signed + paid, still in Admission',
  VISA_APPROVED_NO_PASTORAL: 'Visa approved, no Pastoral handoff',
  INZ_SUBMITTED_AGED: 'INZ submission overdue for follow-up',
};
const RULE_ICON: Record<StuckRule, React.ReactNode> = {
  SIGNED_PAID_STUCK_ADMISSION: <PauseCircle size={14} className="text-amber-600" />,
  VISA_APPROVED_NO_PASTORAL: <UserX size={14} className="text-amber-600" />,
  INZ_SUBMITTED_AGED: <AlertTriangle size={14} className="text-amber-600" />,
};

function humanizeReason(reason: string | null): string {
  if (!reason) return '';
  const s = reason.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface HandoffLogRow {
  id: string;
  fromSlot: string;
  toSlot: string;
  fromUserName: string | null;
  toUserName: string | null;
  createdAt: string;
  firstViewedAt: string | null;
  case: { id: string; lead: { clientId: string | null; contact: { fullName: string | null } | null } | null } | null;
}

const HANDOFF_SLOT_LABEL: Record<string, string> = {
  ADMISSION: 'Admission', SUPPORT: 'Student Support',
  FINANCE: 'Finance', LIA: 'Immigration Adviser',
};

export function HandoffsClient() {
  const [data, setData] = useState<HandoffsResponse | null>(null);
  const [error, setError] = useState(false);
  // PR-HANDOFF — the handoff log. Was "waiting to be accepted" until handoffs
  // became automatic; it is now a history, which is the more useful thing under
  // an oversight page and the groundwork the KPI layer will read. Fetched
  // separately so a failure here cannot blank the two stuck-case sections,
  // which are the older and more load-bearing half of this page.
  const [pending, setPending] = useState<HandoffLogRow[] | null>(null);

  useEffect(() => {
    api.get<HandoffsResponse>('/api/staff/handoffs').then(setData).catch(() => setError(true));
    api.get<HandoffLogRow[]>('/api/staff/handoffs/recent-handoffs').then(setPending).catch(() => setPending([]));
  }, []);

  const staffingRows = data?.staffing.rows ?? [];
  const stuckRows = data?.stuck ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10 space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <ArrowLeftRight size={22} className="text-[#1e3a5f]" />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Handoffs</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Where responsibility should have passed to the next role but hasn’t — unstaffed slots and
          cases stalled between stages. Read-only; each row links to the case to action it.
        </p>
      </div>

      {error && <ErrorNote>Couldn’t load the handoffs queue. Please refresh.</ErrorNote>}

      {!data && !error && (
        <Card><CardContent><LoadingRow /></CardContent></Card>
      )}

      {/* ── 1. Unstaffed roles (reuse /ops/handoffs rules) ───────────────── */}
      {data && (
        <Section
          icon={<Users size={16} className="text-[#b8941f]" />}
          title="Unstaffed roles"
          subtitle="A specialist slot is due but empty — past the point auto-assignment should have filled it. Oldest-waiting first."
        >
          {/* Consultant pool banner */}
          {data.staffing.consultantPoolEmpty && data.staffing.unstaffedConsultantCount > 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  No Client Officers configured — {data.staffing.unstaffedConsultantCount}{' '}
                  {data.staffing.unstaffedConsultantCount === 1 ? 'case is' : 'cases are'} unstaffed
                </p>
                <p className="mt-0.5 text-xs text-amber-800">
                  Every eligible case is missing its Client Officer. Create one so auto-assignment can staff them.
                </p>
              </div>
            </div>
          )}

          {staffingRows.length === 0 ? (
            <Empty icon={<CheckCircle2 size={28} className="text-[#c9a961]" />}
              title="Every due slot is staffed" sub="No role handoffs are currently stuck." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2.5 px-3 font-semibold">Client</th>
                    <th className="py-2.5 px-3 font-semibold">Stage</th>
                    <th className="py-2.5 px-3 font-semibold">Missing role(s)</th>
                    <th className="py-2.5 px-3 font-semibold">Waiting</th>
                    <th className="py-2.5 px-3 font-semibold">Reason</th>
                    <th className="py-2.5 px-3 font-semibold w-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {staffingRows.map((r) => {
                    const reasons = Array.from(new Set(
                      r.missingSlots.map((m) => humanizeReason(m.reason)).filter(Boolean),
                    ));
                    return (
                      <tr key={r.caseId} className="border-b border-gray-50 hover:bg-[#faf8f3]">
                        <td className="py-2.5 px-3 font-medium text-[#1e3a5f]">{r.clientName ?? '—'}</td>
                        <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">{STAGE_LABEL[r.stage] ?? r.stage}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {r.missingSlots.map((m) => (
                              <Chip key={m.slot} tone="red">{SLOT_LABEL[m.slot]}</Chip>
                            ))}
                            {r.wrongRoleOwner && <Chip tone="amber">Wrong-role owner</Chip>}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">
                          {r.waitingSinceEarliest ? formatRelativeTime(r.waitingSinceEarliest) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-gray-500">{reasons.length ? reasons.join(', ') : '—'}</td>
                        <td className="py-2.5 px-3">
                          <Link href={`/staff/cases/${r.caseId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1e3a5f] hover:underline whitespace-nowrap">
                            Case <ArrowRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* ── 2. Stuck cases (NEW, state-derived) ──────────────────────────── */}
      {data && (
        <Section
          icon={<PauseCircle size={16} className="text-[#b8941f]" />}
          title="Stuck cases"
          subtitle={`Cases that cleared a gate but didn't move on — signed + paid yet still in Admission, visa approved without a Pastoral handoff, or over ${data.inzAgeThresholdDays} days in INZ with no outcome. Oldest first.`}
        >
          {stuckRows.length === 0 ? (
            <Empty icon={<CheckCircle2 size={28} className="text-[#c9a961]" />}
              title="Nothing is stalled" sub="Every case that cleared a gate has moved on to its next step." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2.5 px-3 font-semibold">Client</th>
                    <th className="py-2.5 px-3 font-semibold">Stage</th>
                    <th className="py-2.5 px-3 font-semibold">Stalled on</th>
                    <th className="py-2.5 px-3 font-semibold">Waiting</th>
                    <th className="py-2.5 px-3 font-semibold w-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {stuckRows.map((r) => (
                    <tr key={`${r.caseId}-${r.rule}`} className="border-b border-gray-50 hover:bg-[#faf8f3]">
                      <td className="py-2.5 px-3 font-medium text-[#1e3a5f]">{r.clientName ?? '—'}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">{STAGE_LABEL[r.stage] ?? r.stage}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1e3a5f]">
                          {RULE_ICON[r.rule]} {RULE_LABEL[r.rule]}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{r.detail}</div>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">
                        {r.waitingSince ? formatRelativeTime(r.waitingSince) : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <Link href={`/staff/cases/${r.caseId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1e3a5f] hover:underline whitespace-nowrap">
                          Case <ArrowRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* ── 3. Pending handoffs (PR-HANDOFF) ──────────────────────────────
          Explicit handoffs nobody has accepted yet. The two sections above infer
          neglect from state; this shows the deliberate act, so a case someone
          passed on and nobody picked up is visible immediately rather than only
          once it has been stuck long enough to trip a rule. */}
      <Section
        icon={<ArrowLeftRight size={14} className="text-[#1e3a5f]" />}
        title="Recent handoffs"
        subtitle="The 50 most recent, newest first. Full history is kept in the record."
      >
        {pending === null && <p className="text-sm text-gray-400">Loading…</p>}
        {pending?.length === 0 && (
          <p className="text-sm text-gray-500">No handoffs recorded yet.</p>
        )}
        {!!pending?.length && (
          <ul className="divide-y divide-gray-100">
            {pending.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-[#1e3a5f]">
                    {h.case?.lead?.contact?.fullName ?? 'Unknown client'}
                  </span>
                  {h.case?.lead?.clientId && (
                    <code className="ml-2 font-mono text-[11px] text-gray-400">{h.case.lead.clientId}</code>
                  )}
                  <span className="ml-2 text-gray-500">
                    {HANDOFF_SLOT_LABEL[h.fromSlot] ?? h.fromSlot} → {HANDOFF_SLOT_LABEL[h.toSlot] ?? h.toSlot}
                  </span>
                </span>
                <span className="text-xs text-gray-400">
                  {h.fromUserName ?? 'someone'} → {h.toUserName ?? 'unassigned'} ·{' '}
                  {new Date(h.createdAt).toLocaleDateString('en-NZ')}
                  {/* Passive signal: whether the recipient has opened it yet. Not a
                      warning — an unopened recent handoff is entirely normal. */}
                  {h.firstViewedAt ? ' · opened' : ' · not opened yet'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ── Small presentational helpers (mirrors ComplianceClient) ──────────────────
function Section({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <div className="mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">{icon} {title}</h2>
          <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
function Chip({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'red'
    ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}
function LoadingRow() {
  return <div className="flex items-center gap-2 py-8 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> Loading…</div>;
}
function ErrorNote({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{children}</div>;
}
function Empty({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto mb-2">{icon}</div>
      <p className="text-sm font-medium text-[#4A4A4A]">{title}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  );
}
