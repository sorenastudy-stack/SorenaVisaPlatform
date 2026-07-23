'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Mail, Phone, Globe, Award, ExternalLink, UserCog,
  Megaphone, AlertTriangle, Clock, Briefcase,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRoleLabel } from '@/lib/role-label';
import { displayCountry } from '@/lib/country-codes';
import { Card, CardContent } from '@/components/ui/Card';
import {
  LeadStatusChip,
  ALL_LEAD_STATUSES,
  leadStatusLabel,
  type LeadStatus,
} from '@/components/leads/LeadStatusChip';
import { LeadSourceChip } from '@/components/leads/LeadSourceChip';
import {
  ScorecardBandChip,
  type ScorecardBand,
} from '@/components/scorecard/ScorecardBandChip';

// PR-CRM-LEADS — Staff lead detail page.
//
// Reads /staff/leads/:id (which writes the LEAD_VIEWED_BY_STAFF audit
// row server-side). Status + assignment mutations happen client-side
// and refetch on success.
//
// The Wix payments card reuses the existing component shipped by
// PR-SCORECARD-4 — only OWNER / SUPER_ADMIN / ADMIN / FINANCE see
// rows; the component silently hides itself on 403.

interface LeadDetail {
  id: string;
  clientId: string | null;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  source: string | null;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  // PR-CRM-CASE-CREATE — case-creation gate state for the action card.
  // Mirrors the backend CasesService.createCase precondition exactly.
  executionAllowed: boolean;
  hardStopFlag: boolean;
  hardStopReason: string | null;
  caseId: string | null;
  assignedTo: { id: string; name: string; role: string } | null;
  attributedAgent: { id: string; fullName: string } | null;
  trackingLink: {
    id: string;
    shortCode: string;
    channel: string;
    campaignLabel: string | null;
  } | null;
  scorecard: {
    submissionId: string;
    band: ScorecardBand;
    totalScore: number;
    submittedAt: string;
    executionEligible: boolean;
    hardStopsCount: number;
  } | null;
  statusHistory: Array<{
    status: LeadStatus;
    changedAt: string;
    changedByName: string | null;
  }>;
}

interface Assignee {
  id: string;
  name: string;
  role: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-NZ', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export default function StaffLeadDetailPage({
  params,
}: { params: { id: string } }) {
  const { id } = params;

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<LeadDetail>(`/staff/leads/${id}`);
      setLead(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load lead');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    api.get<Assignee[]>('/staff/leads/assignees')
      .then(setAssignees)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return <div className="text-sm text-[#4A4A4A]/60 py-4">Loading…</div>;
  }

  if (error || !lead) {
    return (
      <div>
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error ?? 'Lead not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <BackLink />

      {/* Header */}
      <Card className="mb-4">
        <CardContent>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-[#1E3A5F] truncate">{lead.name}</h1>
              {lead.clientId && (
                <div className="mt-0.5 font-mono text-sm font-semibold text-[#b8941f]" title="Client ID">
                  {lead.clientId}
                </div>
              )}
              <div className="mt-1 flex items-center gap-3 flex-wrap text-sm text-[#4A4A4A]/70">
                {lead.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail size={12} />{lead.email}
                  </span>
                )}
                {lead.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone size={12} />{lead.phone}
                  </span>
                )}
                {lead.country && (
                  <span className="inline-flex items-center gap-1">
                    <Globe size={12} />{displayCountry(lead.country) ?? lead.country}
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <LeadSourceChip source={lead.source} />
                <LeadStatusChip status={lead.status} />
                {lead.scorecard && <ScorecardBandChip band={lead.scorecard.band} />}
              </div>
            </div>
            <div className="text-xs text-[#4A4A4A]/60 flex flex-col items-end">
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> Created {relativeDays(lead.createdAt)}
              </span>
              <span className="font-mono mt-0.5">{lead.id.slice(0, 8)}…</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ─── Left column ─────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <StatusCard
            current={lead.status}
            onSaved={() => load()}
            leadId={lead.id}
          />
          <AssignmentCard
            currentAssignee={lead.assignedTo}
            assignees={assignees}
            onSaved={() => load()}
            leadId={lead.id}
          />
          <CreateCaseCard
            leadId={lead.id}
            caseId={lead.caseId}
            executionAllowed={lead.executionAllowed}
            hardStopFlag={lead.hardStopFlag}
            hardStopReason={lead.hardStopReason}
          />
          <StatusHistoryCard history={lead.statusHistory} />
        </div>

        {/* ─── Right column ────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <ScorecardCard scorecard={lead.scorecard} />

          <AttributionCard
            attributedAgent={lead.attributedAgent}
            trackingLink={lead.trackingLink}
          />

          {/* Quick deep-dive link to the existing sales-side view —
              that page already hosts the override panel, AI summary,
              and other advanced controls we don't surface here. */}
          <Card>
            <CardContent>
              <Link
                href={`/sales/leads/${lead.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]"
              >
                Open in legacy sales view <ExternalLink size={12} />
              </Link>
              <p className="text-xs text-[#4A4A4A]/60 mt-1">
                The sales-side detail page exposes the override panel and full status-transition history.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/staff/leads"
      className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#b8941f] font-medium mb-4"
    >
      <ArrowLeft size={14} /> Back to leads
    </Link>
  );
}

// ─── StatusCard ────────────────────────────────────────────────────

function StatusCard({
  current, leadId, onSaved,
}: {
  current: LeadStatus;
  leadId: string;
  onSaved: () => void;
}) {
  const [next, setNext] = useState<LeadStatus>(current);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setNext(current); }, [current]);

  async function save() {
    if (next === current) return;
    setErr(null);
    setSaving(true);
    try {
      await api.patch(`/staff/leads/${leadId}/status`, {
        status: next,
        note: note.trim() || undefined,
      });
      setNote('');
      onSaved();
    } catch (e: any) {
      // 403 → role lacks change-status permission.
      if (e?.statusCode === 403) setErr('Your role can’t change lead status.');
      else setErr(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-3">Status</h2>
        <div className="mb-3">
          <LeadStatusChip status={current} />
        </div>
        <select
          value={next}
          onChange={(e) => setNext(e.target.value as LeadStatus)}
          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
        >
          {ALL_LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{leadStatusLabel(s)}</option>
          ))}
        </select>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (optional)…"
          rows={2}
          className="mt-2 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
        />
        {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
        <button
          type="button"
          onClick={save}
          disabled={saving || next === current}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#162d49] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save status'}
        </button>
      </CardContent>
    </Card>
  );
}

// ─── AssignmentCard ───────────────────────────────────────────────

function AssignmentCard({
  currentAssignee, assignees, leadId, onSaved,
}: {
  currentAssignee: { id: string; name: string; role: string } | null;
  assignees: Assignee[];
  leadId: string;
  onSaved: () => void;
}) {
  const [next, setNext] = useState<string>(currentAssignee?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const roleLabel = useRoleLabel();

  useEffect(() => { setNext(currentAssignee?.id ?? ''); }, [currentAssignee?.id]);

  async function save() {
    if ((next || null) === (currentAssignee?.id ?? null)) return;
    setErr(null);
    setSaving(true);
    try {
      await api.patch(`/staff/leads/${leadId}/assign`, {
        assignedToId: next.length > 0 ? next : null,
      });
      onSaved();
    } catch (e: any) {
      if (e?.statusCode === 403) setErr('Only OWNER / SUPER_ADMIN / ADMIN can reassign.');
      else setErr(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-3 inline-flex items-center gap-1">
          <UserCog size={13} /> Assignment
        </h2>
        <div className="mb-3 text-sm text-[#1E3A5F]">
          {currentAssignee
            ? <>{currentAssignee.name} <span className="text-xs text-[#4A4A4A]/70">({roleLabel(currentAssignee.role)})</span></>
            : <span className="italic text-[#4A4A4A]/60">Unassigned</span>}
        </div>
        <select
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
        >
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({roleLabel(a.role)})</option>
          ))}
        </select>
        {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
        <button
          type="button"
          onClick={save}
          disabled={saving || (next || null) === (currentAssignee?.id ?? null)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg border-2 border-[#1E3A5F] text-[#1E3A5F] text-sm font-bold hover:bg-[#1E3A5F]/5 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Reassign'}
        </button>
      </CardContent>
    </Card>
  );
}

// ─── CreateCaseCard ───────────────────────────────────────────────
//
// PR-CRM-CASE-CREATE — convert a qualified lead into a Case. Four
// mutually-exclusive states, prioritised in this order:
//
//   1. caseId is set            → "View case" (link to existing)
//   2. hardStopFlag              → disabled + hardStopReason / generic
//   3. !executionAllowed         → disabled + "not yet qualified"
//   4. ready                     → active "Create case" → POST /cases
//                                  → router.push('/staff/cases/:newId')
//
// Backend gate (`!lead.executionAllowed || lead.hardStopFlag`) is
// mirrored exactly so the disabled state always matches what the
// API would do — no surprise 400s. Errors from the POST are caught
// and surfaced inline; the success path navigates away so we don't
// reset `creating` (the component unmounts on push).

function CreateCaseCard({
  leadId, caseId, executionAllowed, hardStopFlag, hardStopReason,
}: {
  leadId: string;
  caseId: string | null;
  executionAllowed: boolean;
  hardStopFlag: boolean;
  hardStopReason: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setErr(null);
    setCreating(true);
    try {
      const created = await api.post<{ id: string }>('/cases', { leadId });
      router.refresh();
      router.push(`/staff/cases/${created.id}`);
      // Intentionally do NOT reset `creating` here — the component
      // unmounts on navigation, and clearing the state would briefly
      // flash the active button before the page transitions.
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create case');
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-3 inline-flex items-center gap-1">
          <Briefcase size={13} /> Case
        </h2>

        {caseId ? (
          <>
            <p className="text-sm text-[#1E3A5F] mb-3">
              A case has been created for this lead.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/staff/cases/${caseId}`)}
              className="w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#162d49]"
            >
              View case
            </button>
          </>
        ) : hardStopFlag ? (
          <>
            <p className="text-sm text-red-700 mb-3">
              {hardStopReason ?? 'This lead is blocked from case creation.'}
            </p>
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-sm font-bold opacity-50 cursor-not-allowed"
            >
              Create case
            </button>
          </>
        ) : !executionAllowed ? (
          <>
            <p className="text-sm text-[#4A4A4A]/80 mb-3">
              This lead hasn’t qualified for case creation yet.
            </p>
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-sm font-bold opacity-50 cursor-not-allowed"
            >
              Create case
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-[#1E3A5F] mb-3">
              Ready to convert this lead into a case.
            </p>
            {err && (
              <p className="mb-2 text-xs text-red-700">{err}</p>
            )}
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#162d49] disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create case'}
            </button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── StatusHistoryCard ────────────────────────────────────────────

function StatusHistoryCard({ history }: {
  history: LeadDetail['statusHistory'];
}) {
  const top = history.slice(0, 5);
  return (
    <Card>
      <CardContent>
        <h2 className="text-sm font-bold text-[#1E3A5F] uppercase tracking-wide mb-3">
          Status history
        </h2>
        {top.length === 0 ? (
          <p className="text-sm text-[#4A4A4A]/60 italic">No changes yet.</p>
        ) : (
          <ul className="space-y-2">
            {top.map((h, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <LeadStatusChip status={h.status} compact />
                  <span className="text-[#4A4A4A]/60">{formatDate(h.changedAt)}</span>
                </div>
                {h.changedByName && (
                  <div className="mt-0.5 text-[#4A4A4A]/70">by {h.changedByName}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ScorecardCard ────────────────────────────────────────────────

function ScorecardCard({ scorecard }: {
  scorecard: LeadDetail['scorecard'];
}) {
  if (!scorecard) {
    return (
      <Card>
        <CardContent>
          <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-2">
            <Award size={16} className="text-[#b8941f]" /> Scorecard
          </h2>
          <p className="text-sm text-[#4A4A4A]/60 italic">No assessment yet.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2">
            <Award size={16} className="text-[#b8941f]" /> Scorecard
          </h2>
          <Link
            href={`/staff/scorecards/${scorecard.submissionId}`}
            className="text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f] inline-flex items-center gap-1"
          >
            View full scorecard <ExternalLink size={12} />
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Band"><ScorecardBandChip band={scorecard.band} /></Stat>
          <Stat label="Score">
            <span className="font-mono text-lg font-bold text-[#1E3A5F]">
              {scorecard.totalScore}<span className="text-sm text-[#4A4A4A]/60"> / 100</span>
            </span>
          </Stat>
          <Stat label="Submitted">{formatDate(scorecard.submittedAt)}</Stat>
          <Stat label="Eligible">
            <span className={scorecard.executionEligible ? 'text-emerald-700 font-semibold' : 'text-gray-500'}>
              {scorecard.executionEligible ? 'Yes' : 'Not yet'}
            </span>
          </Stat>
        </div>
        {scorecard.hardStopsCount > 0 && (
          <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-red-700">
            <AlertTriangle size={12} />
            {scorecard.hardStopsCount} hard stop{scorecard.hardStopsCount === 1 ? '' : 's'} on this submission
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[#4A4A4A]/60">{label}</div>
      <div className="text-sm text-[#1E3A5F] mt-0.5">{children}</div>
    </div>
  );
}

// ─── AttributionCard ──────────────────────────────────────────────

function AttributionCard({
  attributedAgent, trackingLink,
}: {
  attributedAgent: LeadDetail['attributedAgent'];
  trackingLink: LeadDetail['trackingLink'];
}) {
  if (!attributedAgent && !trackingLink) return null;
  return (
    <Card>
      <CardContent>
        <h2 className="text-base font-bold text-[#1E3A5F] flex items-center gap-2 mb-2">
          <Megaphone size={16} className="text-[#b8941f]" /> Attribution
        </h2>
        <div className="space-y-1.5 text-sm">
          {attributedAgent && (
            <div>
              <span className="text-[#4A4A4A]/70">Referred by</span>{' '}
              <Link
                href={`/staff/marketing/agents/${attributedAgent.id}`}
                className="font-semibold text-[#1E3A5F] hover:text-[#b8941f] underline-offset-2 hover:underline"
              >
                {attributedAgent.fullName}
              </Link>
            </div>
          )}
          {trackingLink && (
            <div>
              <span className="text-[#4A4A4A]/70">Marketing channel:</span>{' '}
              <span className="font-semibold text-[#1E3A5F]">{trackingLink.channel}</span>
              {trackingLink.campaignLabel && (
                <span className="text-[#4A4A4A]/70"> (campaign: {trackingLink.campaignLabel})</span>
              )}
              {trackingLink.shortCode && (
                <span className="text-[#4A4A4A]/60 text-xs font-mono ml-2">{trackingLink.shortCode}</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
