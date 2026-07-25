'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, FileWarning, ScrollText, ClipboardCheck,
  ArrowRight, Loader2, ExternalLink, Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { formatRelativeTime } from '@/lib/format-relative-time';

// PR-COMPLIANCE — Owner-dashboard Compliance section. Composes:
//   1. Flagged cases (NEW)          — GET /api/staff/compliance/flagged-cases
//   2. Contract exceptions (reuse)  — GET /ops/compliance/non-compliant
//   3. Override / audit log (reuse) — GET /api/staff/compliance/override-log (→ /admin/audit)
//   4. Owner-approval queue (reuse) — link to /staff/approvals
// Read-only; every action lives on the linked surface.

// ── Types ──────────────────────────────────────────────────────────────────
interface FlaggedRow {
  leadId: string; clientId: string | null; clientName: string | null;
  caseId: string | null; caseStage: string | null;
  hardStop: boolean; hardStopReason: string | null; redFlag: boolean;
  liaApproved: boolean; contractSent: boolean;
  status: 'HARD_STOP' | 'AWAITING_LIA' | 'APPROVED_UNCLEARED';
  routingCompliance: 'COMPLIANT' | 'BREACH' | 'NOT_APPLICABLE';
  routingDetail: string;
  flaggedSince: string;
}
type Reason = 'contract_missing' | 'contract_unsigned' | 'contract_stalled' | 'contract_declined';
interface ContractRow { caseId: string; clientName: string | null; stage: string; reason: Reason; since: string | null; }
interface OverrideRow {
  id: string; createdAt: string; eventType: string | null; action: string;
  entityType: string | null; entityId: string | null; actorName: string; actorRole: string | null;
}

const STATUS_LABEL: Record<FlaggedRow['status'], string> = {
  HARD_STOP: 'Hard stop — not cleared',
  AWAITING_LIA: 'Awaiting LIA review',
  APPROVED_UNCLEARED: 'LIA approved (flag pending clear)',
};
const CONTRACT_ISSUE: Record<Reason, string> = {
  contract_missing: 'No contract on file',
  contract_unsigned: 'Contract never signed',
  contract_stalled: 'Contract sent, not signed',
  contract_declined: 'Client declined the contract',
};
const STAGE_LABEL: Record<string, string> = {
  ADMISSION: 'Admission', VISA: 'Visa', INZ_SUBMITTED: 'INZ submitted',
  COMPLETED: 'Completed', WITHDRAWN: 'Withdrawn',
};

export function ComplianceClient() {
  const [flagged, setFlagged] = useState<FlaggedRow[] | null>(null);
  const [contracts, setContracts] = useState<ContractRow[] | null>(null);
  const [overrides, setOverrides] = useState<OverrideRow[] | null>(null);
  const [errs, setErrs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.get<FlaggedRow[]>('/api/staff/compliance/flagged-cases').then(setFlagged).catch(() => setErrs((e) => ({ ...e, flagged: true })));
    api.get<{ rows: ContractRow[] }>('/ops/compliance/non-compliant').then((d) => setContracts(d.rows)).catch(() => setErrs((e) => ({ ...e, contracts: true })));
    api.get<OverrideRow[]>('/api/staff/compliance/override-log?limit=25').then(setOverrides).catch(() => setErrs((e) => ({ ...e, overrides: true })));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10 space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck size={22} className="text-[#1e3a5f]" />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Compliance</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Flagged cases, contract exceptions, and the override/audit trail — everything that needs oversight, in one place.
        </p>
      </div>

      {/* ── 1. Flagged cases (NEW) ─────────────────────────────────────── */}
      <Section icon={<ShieldAlert size={16} className="text-[#b8941f]" />} title="Flagged cases"
        subtitle="Leads/cases with an active hard stop (HS1-HS6) or red-flag (LIA escalation). Cleared/approved leads drop off automatically.">
        {errs.flagged && <ErrorNote>Couldn’t load flagged cases.</ErrorNote>}
        {!flagged && !errs.flagged && <LoadingRow />}
        {flagged && flagged.length === 0 && (
          <Empty icon={<ShieldCheck size={28} className="text-[#c9a961]" />} title="No flagged cases" sub="Nothing is currently hard-stopped or awaiting LIA review." />
        )}
        {flagged && flagged.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2.5 px-3 font-semibold">Client</th>
                  <th className="py-2.5 px-3 font-semibold">Flag</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">LIA routing</th>
                  <th className="py-2.5 px-3 font-semibold">Flagged</th>
                  <th className="py-2.5 px-3 font-semibold w-0"></th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((r) => (
                  <tr key={r.leadId} className="border-b border-gray-50 hover:bg-[#faf8f3]">
                    <td className="py-2.5 px-3">
                      <Link href={`/staff/leads/${r.leadId}`} className="font-medium text-[#1e3a5f] hover:underline">
                        {r.clientName ?? '—'}
                      </Link>
                      {r.clientId && <div className="font-mono text-[10px] text-gray-400">{r.clientId}</div>}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-1">
                        {r.hardStop && <Chip tone="red">Hard stop</Chip>}
                        {r.redFlag && <Chip tone="amber">Red flag</Chip>}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-600">{STATUS_LABEL[r.status]}</td>
                    <td className="py-2.5 px-3"><RoutingBadge v={r.routingCompliance} detail={r.routingDetail} /></td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">{formatRelativeTime(r.flaggedSince)}</td>
                    <td className="py-2.5 px-3">
                      {r.caseId ? (
                        <Link href={`/staff/cases/${r.caseId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1e3a5f] hover:underline whitespace-nowrap">
                          Case <ArrowRight size={12} />
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">No case yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── 2. Contract compliance exceptions (reuse) ──────────────────── */}
      <Section icon={<FileWarning size={16} className="text-[#b8941f]" />} title="Contract compliance exceptions"
        subtitle="Active cases whose engagement contract needs attention — longest-waiting first.">
        {errs.contracts && <ErrorNote>Couldn’t load contract exceptions.</ErrorNote>}
        {!contracts && !errs.contracts && <LoadingRow />}
        {contracts && contracts.length === 0 && (
          <Empty icon={<ShieldCheck size={28} className="text-[#c9a961]" />} title="Every active case is in good standing" sub="No contract issues need attention right now." />
        )}
        {contracts && contracts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2.5 px-3 font-semibold">Client</th>
                  <th className="py-2.5 px-3 font-semibold">Stage</th>
                  <th className="py-2.5 px-3 font-semibold">Issue</th>
                  <th className="py-2.5 px-3 font-semibold">Waiting</th>
                  <th className="py-2.5 px-3 font-semibold w-0"></th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((r) => (
                  <tr key={r.caseId} className="border-b border-gray-50 hover:bg-[#faf8f3]">
                    <td className="py-2.5 px-3 font-medium text-[#1e3a5f]">{r.clientName ?? '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{STAGE_LABEL[r.stage] ?? r.stage}</td>
                    <td className="py-2.5 px-3"><Chip tone="amber">{CONTRACT_ISSUE[r.reason]}</Chip></td>
                    <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">{r.since ? formatRelativeTime(r.since) : '—'}</td>
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

      {/* ── 3. Override & audit log (reuse, pre-filtered) ──────────────── */}
      <Section icon={<ScrollText size={16} className="text-[#b8941f]" />} title="Override & audit log"
        subtitle="Recent high-sensitivity actions — hard-stop clears, gate clears, legal decisions, manual reassignments, settings changes."
        action={<Link href="/admin/audit" className="inline-flex items-center gap-1 text-xs font-semibold text-[#1e3a5f] hover:underline">Full audit log <ExternalLink size={12} /></Link>}>
        {errs.overrides && <ErrorNote>Couldn’t load the override log.</ErrorNote>}
        {!overrides && !errs.overrides && <LoadingRow />}
        {overrides && overrides.length === 0 && (
          <Empty icon={<ScrollText size={28} className="text-[#c9a961]" />} title="No override actions recorded yet" sub="High-sensitivity actions will appear here as they happen." />
        )}
        {overrides && overrides.length > 0 && (
          <ul className="divide-y divide-gray-50">
            {overrides.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 px-1">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#1e3a5f]">{humanEvent(r.eventType ?? r.action)}</div>
                  <div className="text-xs text-gray-500">
                    {r.actorName}{r.actorRole ? ` · ${r.actorRole}` : ''}
                    {r.entityType ? ` · ${r.entityType}` : ''}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                  <Clock size={11} /> {formatRelativeTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── 4. Owner-approval queue (link) ─────────────────────────────── */}
      <Link href="/staff/approvals" className="block">
        <Card className="transition-all hover:border-[#1e3a5f]/30 hover:shadow">
          <CardContent className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ClipboardCheck size={18} className="text-[#b8941f]" />
              <div>
                <div className="text-sm font-bold text-[#1e3a5f]">Owner-approval queue</div>
                <div className="text-xs text-gray-500">Two-person control for staff changes, deletions, refunds, and settings.</div>
              </div>
            </div>
            <ArrowRight size={16} className="text-gray-300" />
          </CardContent>
        </Card>
      </Link>

      {/* ── Deferred (backlog) note ────────────────────────────────────── */}
      <div className="rounded-xl border border-dashed border-gray-200 bg-[#faf8f3] px-4 py-3 text-xs text-gray-500">
        <span className="font-semibold text-gray-600">Not yet built (backlog):</span> a formal
        approval-gated “case routing override”, and “deadline extension approval” — the latter needs a
        deadline/SLA system first, which doesn’t exist yet. Ad-hoc manual reassignment (logged above) covers routing changes today.
      </div>
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────────
function Section({ icon, title, subtitle, action, children }: {
  icon: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">{icon} {title}</h2>
            <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
function Chip({ tone, children }: { tone: 'red' | 'amber' | 'green'; children: React.ReactNode }) {
  const cls = tone === 'red' ? 'bg-red-50 text-red-700 border-red-200'
    : tone === 'green' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}
function RoutingBadge({ v, detail }: { v: FlaggedRow['routingCompliance']; detail: string }) {
  if (v === 'NOT_APPLICABLE') return <span className="text-xs text-gray-400" title={detail}>—</span>;
  if (v === 'COMPLIANT') return <span title={detail} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><ShieldCheck size={13} /> Compliant</span>;
  return <span title={detail} className="inline-flex items-center gap-1 text-xs font-semibold text-red-700"><AlertTriangle size={13} /> Breach</span>;
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
function humanEvent(code: string): string {
  return code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
