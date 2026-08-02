'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  GraduationCap, ListOrdered, FileText, ScrollText, Award, Send,
  ExternalLink, Check, X, Briefcase, Trash2, Plus, Lock, RefreshCw, Sparkles, Loader2,
  ShieldCheck, ShieldAlert, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { CaseDetail } from './types';

// PR-ADMISSION-CASEFILE (step 1) — the Admission Specialist substance on the Case File.
// DISPLAY ONLY, wired to REAL existing data: the client's latest scorecard (from the case
// detail payload) and their programme-choice priority list (the SAME staff endpoint + the
// SAME PR-SLOTRULES mandatory-type rule the student surface uses — no logic duplicated).
// CV / SOP / Offer / Submission sections are honest empty-state placeholders that later
// steps (2–6) fill in — never fake content.

interface Choice {
  id: string; programmeId: string; programmeName: string | null; providerName: string | null;
  institutionType: string | null; intakeMonth: number; intakeYear: number; priority: number;
}
interface ChoicesResp { applicationStatus: string; choices: Choice[] }
interface MandatorySlot { position: number; institutionType: string }
interface Rules { enabled: boolean; mandatorySlots: MandatorySlot[] }
interface Employment {
  id: string; employerName: string; roleTitle: string; startYear: number | null; endYear: number | null;
  isCurrent: boolean; countryOfWork: string | null; organisationField: string | null; dutiesText: string | null; sortOrder: number;
}
interface CvContent {
  header: { fullName: string; email: string | null; phone: string | null; country: string | null; dateOfBirth: string | null; nationality: string | null };
  summary: string;
  education: Array<{ institution: string; qualification: string; field: string | null; country: string | null; startYear: number | null; endYear: number | null; completed: boolean }>;
  experience: Array<{ employer: string; role: string; field: string | null; country: string | null; startYear: number | null; endYear: number | null; isCurrent: boolean; duties: string | null }>;
  english: { test: string; note: string | null } | null;
  skills: string[];
}
interface CvDoc { id: string; version: number; status: string; content: CvContent; generatedAt: string; editedAt: string | null; approvedAt: string | null; aiUnavailable?: boolean }
interface CvResp { current: CvDoc | null; versions: Array<{ id: string; version: number; status: string; generatedAt: string; approvedAt: string | null }> }

// ── SOP (PR-ADMISSION-SOP, step 3) ──────────────────────────────────────────
type SopGateKey = 'careerPlan' | 'nzReasoning' | 'homeTies';
interface SopGateVerdict { pass: boolean; reason: string }
interface SopGateEvaluation {
  results: Record<SopGateKey, SopGateVerdict>;
  enforced: boolean; allPass: boolean; failing: SopGateKey[]; blocksApproval: boolean;
}
interface SopNarrative { intro: string; careerPlan: string; whyNewZealand: string; whyThisInstitution: string; homeTies: string; conclusion: string }
interface SopContent {
  frame: {
    applicantName: string; homeCountry: string | null; highestQualification: string | null;
    currentRole: string | null; englishTest: string | null;
    target: { programme: string; provider: string | null; field: string | null; level: string | null; intake: string | null };
  };
  narrative: SopNarrative;
}
interface SopDoc {
  id: string; choiceId: string; version: number; status: string; content: SopContent;
  gates: SopGateEvaluation | null; generatedAt: string; editedAt: string | null; approvedAt: string | null; aiUnavailable?: boolean;
}
interface SopChoice {
  choiceId: string; priority: number; programme: string; provider: string | null;
  intake: { month: number | null; year: number | null }; sop: SopDoc | null;
}
interface SopListResp { applicationStatus: string | null; choices: SopChoice[] }

const SOP_GATE_ORDER: SopGateKey[] = ['careerPlan', 'nzReasoning', 'homeTies'];
const SOP_GATE_LABEL: Record<SopGateKey, string> = {
  careerPlan: 'Career-plan specificity',
  nzReasoning: 'New Zealand–specific reasoning',
  homeTies: 'Home-country ties',
};
// The editable narrative sections, in reading order, with which gate each feeds.
const SOP_SECTIONS: Array<{ key: keyof SopNarrative; label: string; gate?: SopGateKey; rows: number }> = [
  { key: 'intro', label: 'Introduction', rows: 3 },
  { key: 'careerPlan', label: 'Career plan', gate: 'careerPlan', rows: 3 },
  { key: 'whyNewZealand', label: 'Why New Zealand', gate: 'nzReasoning', rows: 3 },
  { key: 'whyThisInstitution', label: 'Why this institution', gate: 'nzReasoning', rows: 3 },
  { key: 'homeTies', label: 'Home-country ties', gate: 'homeTies', rows: 3 },
  { key: 'conclusion', label: 'Conclusion', rows: 2 },
];

const TYPE_LABEL: Record<string, string> = { UNIVERSITY: 'University', ITP: 'Polytechnic', PTE: 'College' };
const typeLabel = (t: string | null) => (t ? TYPE_LABEL[t] ?? t : 'Unknown type');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const intakeLabel = (m: number, y: number) => `${MONTHS[m - 1] ?? m} ${y}`;
const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const bandLabel = (b: string) => humanize(b);

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#1e3a5f]">
        <Icon size={16} /> {title}
      </div>
      {children}
    </section>
  );
}

function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-sorena-navy/20 bg-white px-4 py-8 text-center text-sm text-gray-500">
      {children}
    </div>
  );
}

// Honest "coming later" placeholder — clearly labelled, never fake data.
function Placeholder({ icon: Icon, title, note }: { icon: LucideIcon; title: string; note: string }) {
  return (
    <Section icon={Icon} title={title}>
      <div className="rounded-xl border border-dashed border-[#c9a961]/40 bg-[#faf8f3] px-4 py-6 text-sm text-[#8a6d10]/80">
        <span className="font-semibold text-[#8a6d10]">Not built yet.</span> {note}
      </div>
    </Section>
  );
}

// Real employment history with staff view/edit (add/remove). The client is the primary
// editor in their application; this lets the Admission Specialist review + correct.
function EmploymentSection({ caseId }: { caseId: string }) {
  const [rows, setRows] = useState<Employment[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const blank = { employerName: '', roleTitle: '', organisationField: '', countryOfWork: '', startYear: '', endYear: '', isCurrent: false, dutiesText: '' };
  const [form, setForm] = useState(blank);

  const load = () => api.get<{ entries: Employment[] }>(`/api/staff/cases/${caseId}/employment-entries`).then((r) => setRows(r.entries)).catch(() => setRows([]));
  useEffect(() => { load(); }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const yrs = (e: Employment) => {
    const s = e.startYear ?? '';
    const end = e.isCurrent ? 'present' : (e.endYear ?? '');
    return s || end ? `${s}${s || end ? '–' : ''}${end}` : '';
  };
  const submit = async () => {
    if (!form.employerName.trim() || !form.roleTitle.trim()) { toast.error('Employer and job title are required.'); return; }
    setSaving(true);
    try {
      await api.post(`/api/staff/cases/${caseId}/employment-entries`, {
        employerName: form.employerName.trim(), roleTitle: form.roleTitle.trim(),
        organisationField: form.organisationField.trim() || null, countryOfWork: form.countryOfWork.trim() || null,
        startYear: form.startYear ? Number(form.startYear) : null, endYear: form.isCurrent ? null : (form.endYear ? Number(form.endYear) : null),
        isCurrent: form.isCurrent, dutiesText: form.dutiesText.trim() || null,
      });
      setForm(blank); setAdding(false); await load();
    } catch (e: any) { toast.error(e?.message ?? 'Could not add role.'); }
    finally { setSaving(false); }
  };
  const del = async (id: string) => {
    if (!window.confirm('Remove this role?')) return;
    try { await api.delete(`/api/staff/cases/${caseId}/employment-entries/${id}`); await load(); }
    catch (e: any) { toast.error(e?.message ?? 'Could not remove role.'); }
  };
  const inp = 'rounded-lg border border-sorena-navy/20 px-2 py-1.5 text-sm';

  return (
    <Section icon={Briefcase} title="Employment history">
      {rows === null ? (
        <EmptyCard>Loading…</EmptyCard>
      ) : rows.length === 0 && !adding ? (
        <EmptyCard>No employment history captured yet.</EmptyCard>
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 rounded-xl border border-sorena-navy/10 bg-white p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#1e3a5f]">{e.roleTitle} <span className="text-gray-400">·</span> {e.employerName}</p>
                <p className="text-xs text-gray-500">{[yrs(e), e.organisationField, e.countryOfWork].filter(Boolean).join(' · ')}</p>
                {e.dutiesText && <p className="mt-0.5 text-xs text-gray-500">{e.dutiesText}</p>}
              </div>
              <button onClick={() => del(e.id)} title="Remove" className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-2 space-y-2 rounded-xl border border-dashed border-sorena-navy/20 bg-white p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input className={inp} placeholder="Employer *" value={form.employerName} onChange={(e) => setForm((f) => ({ ...f, employerName: e.target.value }))} />
            <input className={inp} placeholder="Job title *" value={form.roleTitle} onChange={(e) => setForm((f) => ({ ...f, roleTitle: e.target.value }))} />
            <input className={inp} placeholder="Industry / field" value={form.organisationField} onChange={(e) => setForm((f) => ({ ...f, organisationField: e.target.value }))} />
            <input className={inp} placeholder="Country of work (ISO code)" value={form.countryOfWork} onChange={(e) => setForm((f) => ({ ...f, countryOfWork: e.target.value }))} />
            <input className={inp} type="number" placeholder="Start year" value={form.startYear} onChange={(e) => setForm((f) => ({ ...f, startYear: e.target.value }))} />
            <input className={inp} type="number" placeholder="End year" disabled={form.isCurrent} value={form.endYear} onChange={(e) => setForm((f) => ({ ...f, endYear: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={form.isCurrent} onChange={(e) => setForm((f) => ({ ...f, isCurrent: e.target.checked }))} /> Current role</label>
          <textarea className={`${inp} w-full`} rows={2} placeholder="What they did (optional)" value={form.dutiesText} onChange={(e) => setForm((f) => ({ ...f, dutiesText: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setForm(blank); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">{saving ? 'Saving…' : 'Add role'}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1 text-sm text-[#1e3a5f] hover:underline"><Plus size={15} /> Add a role</button>
      )}
      <p className="mt-1 text-[11px] text-gray-400">The client also edits this in their application. Feeds the AI CV’s experience (next step).</p>
    </Section>
  );
}

// AI-generated CV — generate → review/edit (summary + skills) → approve (locks the version).
// Factual sections (education/experience) come from verified rows and are shown read-only here;
// to change them, edit the Employment/Education data and regenerate.
function yrspan(s: number | null, e: number | null, cur: boolean): string {
  const end = cur ? 'present' : (e ?? '');
  return s || end ? `${s ?? ''}${s || end ? '–' : ''}${end}` : '';
}
function CvSection({ caseId }: { caseId: string }) {
  const [data, setData] = useState<CvResp | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 'gen' | 'save' | 'approve'
  const [summary, setSummary] = useState('');
  const [skills, setSkills] = useState('');

  const load = () => api.get<CvResp>(`/api/staff/cases/${caseId}/cv`).then((r) => {
    setData(r);
    if (r.current) { setSummary(r.current.content.summary ?? ''); setSkills((r.current.content.skills ?? []).join(', ')); }
  }).catch(() => setData({ current: null, versions: [] }));
  useEffect(() => { load(); }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = data?.current ?? null;
  const isDraft = cur?.status === 'DRAFT';

  const generate = async () => {
    setBusy('gen');
    try {
      const r = await api.post<CvDoc & { aiUnavailable?: boolean }>(`/api/staff/cases/${caseId}/cv/generate`, {});
      toast[r.aiUnavailable ? 'message' : 'success'](r.aiUnavailable
        ? 'CV drafted from verified data. AI narrative unavailable — write the summary/skills manually.'
        : `CV v${r.version} generated. Review and approve.`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? 'Could not generate the CV.'); }
    finally { setBusy(null); }
  };
  const save = async () => {
    if (!cur) return;
    setBusy('save');
    try {
      const content = { ...cur.content, summary: summary.trim(), skills: skills.split(',').map((s) => s.trim()).filter(Boolean) };
      await api.patch(`/api/staff/cases/${caseId}/cv/${cur.id}`, { content });
      toast.success('CV saved.');
      await load();
    } catch (e: any) { toast.error(e?.message ?? 'Could not save.'); }
    finally { setBusy(null); }
  };
  const approve = async () => {
    if (!cur) return;
    setBusy('approve');
    try { await api.post(`/api/staff/cases/${caseId}/cv/${cur.id}/approve`, {}); toast.success(`CV v${cur.version} approved and locked.`); await load(); }
    catch (e: any) { toast.error(e?.message ?? 'Could not approve.'); }
    finally { setBusy(null); }
  };

  return (
    <Section icon={FileText} title="AI-generated CV">
      {data === null ? (
        <EmptyCard>Loading…</EmptyCard>
      ) : !cur ? (
        <div className="rounded-xl border border-dashed border-sorena-navy/20 bg-white px-4 py-6 text-center">
          <p className="text-sm text-gray-500">No CV yet. Generate one once the client has <strong>submitted their programme choices</strong> — it’s tailored to the chosen field/university from their verified education + employment data.</p>
          <button onClick={generate} disabled={busy === 'gen'} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
            {busy === 'gen' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate CV
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-sorena-navy/10 bg-white p-4">
          {/* header + status + actions */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-[#1e3a5f]">Version {cur.version}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cur.status === 'APPROVED' ? 'bg-[#15a86b]/12 text-[#15803d]' : 'bg-amber-100 text-amber-700'}`}>
              {cur.status === 'APPROVED' ? <span className="inline-flex items-center gap-1"><Lock size={10} /> Approved (locked)</span> : 'Draft'}
            </span>
            <div className="ms-auto flex gap-2">
              <button onClick={generate} disabled={!!busy} title="Regenerate a new version" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {busy === 'gen' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate
              </button>
              {isDraft && (
                <button onClick={approve} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg bg-[#1e3a5f] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
                  {busy === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                </button>
              )}
            </div>
          </div>

          {/* header block */}
          <p className="text-base font-bold text-[#1e3a5f]">{cur.content.header.fullName}</p>
          <p className="text-xs text-gray-500">{[cur.content.header.email, cur.content.header.phone, cur.content.header.country, cur.content.header.nationality && `Nationality: ${cur.content.header.nationality}`].filter(Boolean).join(' · ')}</p>

          {/* summary (editable when draft) */}
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Professional summary</p>
            {isDraft ? (
              <textarea className="mt-1 w-full rounded-lg border border-sorena-navy/20 px-2 py-1.5 text-sm" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="AI-written or write your own…" />
            ) : (
              <p className="mt-1 text-sm text-gray-700">{cur.content.summary || <span className="text-gray-400">—</span>}</p>
            )}
          </div>

          {/* experience (read-only — from verified rows) */}
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Experience</p>
            {cur.content.experience.length === 0 ? <p className="mt-1 text-xs text-gray-400">No employment on file.</p> : (
              <ul className="mt-1 space-y-1">
                {cur.content.experience.map((x, i) => (
                  <li key={i} className="text-sm text-gray-700"><span className="font-medium text-[#1e3a5f]">{x.role}</span> · {x.employer} <span className="text-gray-400">{[yrspan(x.startYear, x.endYear, x.isCurrent), x.country].filter(Boolean).join(' · ')}</span></li>
                ))}
              </ul>
            )}
          </div>

          {/* education (read-only) */}
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Education</p>
            {cur.content.education.length === 0 ? <p className="mt-1 text-xs text-gray-400">No education on file.</p> : (
              <ul className="mt-1 space-y-1">
                {cur.content.education.map((x, i) => (
                  <li key={i} className="text-sm text-gray-700"><span className="font-medium text-[#1e3a5f]">{x.qualification}</span>{x.field ? `, ${x.field}` : ''} · {x.institution} <span className="text-gray-400">{yrspan(x.startYear, x.endYear, false)}</span></li>
                ))}
              </ul>
            )}
          </div>

          {/* english + skills */}
          {cur.content.english && <p className="mt-3 text-sm text-gray-700"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">English</span> · {cur.content.english.test}</p>}
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Skills</p>
            {isDraft ? (
              <input className="mt-1 w-full rounded-lg border border-sorena-navy/20 px-2 py-1.5 text-sm" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Comma-separated" />
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">{cur.content.skills.length ? cur.content.skills.map((s, i) => <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{s}</span>) : <span className="text-xs text-gray-400">—</span>}</div>
            )}
          </div>

          {isDraft && (
            <div className="mt-4 flex justify-end">
              <button onClick={save} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5f]/30 px-3 py-1.5 text-xs font-semibold text-[#1e3a5f] hover:bg-[#1e3a5f]/5 disabled:opacity-50">
                {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : null} Save edits
              </button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-400">Experience &amp; education come from the client’s verified data — edit those in the Employment/Education sections and regenerate. Approving locks this version.</p>
        </div>
      )}
    </Section>
  );
}

// The three quality gates' status for one SOP: pass/fail + the officer's reason per gate, plus the
// enforced-vs-advisory framing and a clear block banner when approval is being held.
function GatePanel({ gates }: { gates: SopGateEvaluation | null }) {
  if (!gates) return <p className="mt-2 text-xs text-gray-400">Gates not evaluated yet.</p>;
  return (
    <div className="mt-3 rounded-lg border border-sorena-navy/10 bg-[#f8fafc] p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {gates.allPass ? <ShieldCheck size={13} className="text-[#15803d]" /> : <ShieldAlert size={13} className="text-amber-600" />}
        Quality gates {gates.enforced ? <span className="text-gray-400">· enforced</span> : <span className="text-gray-400">· advisory (not enforced for this country)</span>}
      </div>
      {gates.blocksApproval && (
        <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">
          Approval is blocked until all three gates pass. Edit the flagged sections and save.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {SOP_GATE_ORDER.map((k) => {
          const v = gates.results[k];
          const pass = !!v?.pass;
          return (
            <li key={k} className="flex items-start gap-2 text-sm">
              {pass
                ? <Check size={14} className="mt-0.5 shrink-0 text-[#15803d]" />
                : <X size={14} className="mt-0.5 shrink-0 text-red-600" />}
              <span>
                <span className={`font-medium ${pass ? 'text-gray-700' : 'text-red-700'}`}>{SOP_GATE_LABEL[k]}</span>
                {v?.reason && <span className="text-gray-500"> — {v.reason}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// One programme choice + its (versioned) SOP. Owns its own edit/busy state so several SOPs can be
// open at once. Mirrors CvSection's generate → review/edit → approve(lock) flow, with the gate panel.
function SopCard({ caseId, item, reload }: { caseId: string; item: SopChoice; reload: () => Promise<void> }) {
  const sop = item.sop;
  const isDraft = sop?.status === 'DRAFT';
  const [busy, setBusy] = useState<string | null>(null);
  const [narr, setNarr] = useState<SopNarrative | null>(sop?.content.narrative ?? null);

  // Re-sync local edits whenever a new version/content arrives (generate, regenerate, save, reload).
  useEffect(() => {
    setNarr(sop?.content.narrative ?? null);
  }, [sop?.id, sop?.version, sop?.editedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const intake = item.intake.month && item.intake.year ? intakeLabel(item.intake.month, item.intake.year) : null;

  const generate = async () => {
    setBusy('gen');
    try {
      const r = await api.post<SopDoc & { aiUnavailable?: boolean }>(`/api/staff/cases/${caseId}/sop/choices/${item.choiceId}/generate`, {});
      toast[r.aiUnavailable ? 'message' : 'success'](r.aiUnavailable
        ? 'SOP drafted from verified data. AI narrative unavailable — write the sections manually.'
        : `SOP v${r.version} generated for ${item.programme}.`);
      await reload();
    } catch (e: any) { toast.error(e?.message ?? 'Could not generate the SOP.'); }
    finally { setBusy(null); }
  };
  const save = async () => {
    if (!sop || !narr) return;
    setBusy('save');
    try {
      const content = { frame: sop.content.frame, narrative: narr };
      await api.patch(`/api/staff/cases/${caseId}/sop/${sop.id}`, { content });
      toast.success('SOP saved — gates re-checked.');
      await reload();
    } catch (e: any) { toast.error(e?.message ?? 'Could not save.'); }
    finally { setBusy(null); }
  };
  const approve = async () => {
    if (!sop) return;
    setBusy('approve');
    try {
      await api.post(`/api/staff/cases/${caseId}/sop/${sop.id}/approve`, {});
      toast.success(`SOP v${sop.version} approved and locked.`);
      await reload();
    } catch (e: any) {
      // Hard-block: the backend persists the fresh verdicts before throwing, so reload to surface them.
      toast.error(e?.message ?? 'Could not approve this SOP.');
      await reload();
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl border border-sorena-navy/10 bg-white p-4">
      {/* choice header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-[#1e3a5f]/8 px-1.5 py-0.5 text-[11px] font-bold text-[#1e3a5f]">#{item.priority}</span>
        <span className="text-sm font-semibold text-[#1e3a5f]">{item.programme}</span>
        <span className="text-xs text-gray-500">{[item.provider, intake].filter(Boolean).join(' · ')}</span>
        {sop && (
          <>
            <span className="ms-2 text-xs font-bold text-[#1e3a5f]">v{sop.version}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${sop.status === 'APPROVED' ? 'bg-[#15a86b]/12 text-[#15803d]' : 'bg-amber-100 text-amber-700'}`}>
              {sop.status === 'APPROVED' ? <span className="inline-flex items-center gap-1"><Lock size={10} /> Approved (locked)</span> : 'Draft'}
            </span>
          </>
        )}
        {sop && (
          <div className="ms-auto flex gap-2">
            <button onClick={generate} disabled={!!busy} title="Regenerate a new version" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {busy === 'gen' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate
            </button>
            {isDraft && (
              <button onClick={approve} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg bg-[#1e3a5f] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
                {busy === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
              </button>
            )}
          </div>
        )}
      </div>

      {!sop ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">No SOP for this choice yet — it’s tailored to this institution.</p>
          <button onClick={generate} disabled={busy === 'gen'} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
            {busy === 'gen' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate SOP
          </button>
        </div>
      ) : (
        <>
          {/* deterministic factual frame (read-only) */}
          <p className="mt-3 text-sm font-semibold text-[#1e3a5f]">{sop.content.frame.applicantName}</p>
          <p className="text-xs text-gray-500">
            {[sop.content.frame.currentRole, sop.content.frame.highestQualification, sop.content.frame.homeCountry && `Home: ${sop.content.frame.homeCountry}`, sop.content.frame.englishTest].filter(Boolean).join(' · ')}
          </p>
          <p className="text-xs text-gray-500">
            Target: <span className="font-medium text-gray-600">{sop.content.frame.target.programme}</span>
            {sop.content.frame.target.provider ? ` at ${sop.content.frame.target.provider}` : ''}{sop.content.frame.target.intake ? ` · ${sop.content.frame.target.intake}` : ''}
          </p>

          {/* the three quality gates */}
          <GatePanel gates={sop.gates} />

          {/* narrative sections — editable while draft */}
          <div className="mt-3 space-y-3">
            {SOP_SECTIONS.map(({ key, label, gate, rows }) => (
              <div key={key}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {label}{gate && <span className="ms-1 font-normal normal-case text-gray-300">· {SOP_GATE_LABEL[gate]}</span>}
                </p>
                {isDraft && narr ? (
                  <textarea
                    className="mt-1 w-full rounded-lg border border-sorena-navy/20 px-2 py-1.5 text-sm"
                    rows={rows}
                    value={narr[key]}
                    onChange={(e) => setNarr({ ...narr, [key]: e.target.value })}
                    placeholder="AI-written or write your own…"
                  />
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{sop.content.narrative[key] || <span className="text-gray-400">—</span>}</p>
                )}
              </div>
            ))}
          </div>

          {isDraft && (
            <div className="mt-4 flex justify-end">
              <button onClick={save} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5f]/30 px-3 py-1.5 text-xs font-semibold text-[#1e3a5f] hover:bg-[#1e3a5f]/5 disabled:opacity-50">
                {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : null} Save edits
              </button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-400">The applicant/target line is verified data (unchangeable here). Saving re-checks the gates; approving locks this version.</p>
        </>
      )}
    </div>
  );
}

function SopSection({ caseId }: { caseId: string }) {
  const [data, setData] = useState<SopListResp | null>(null);
  const [genAll, setGenAll] = useState(false);

  const load = async () => {
    await api.get<SopListResp>(`/api/staff/cases/${caseId}/sop`)
      .then(setData)
      .catch(() => setData({ applicationStatus: null, choices: [] }));
  };
  useEffect(() => { load(); }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitted = data?.applicationStatus === 'SUBMITTED' || data?.applicationStatus === 'LOCKED';
  const choices = data?.choices ?? [];
  const missing = choices.filter((c) => !c.sop).length;

  const generateAll = async () => {
    setGenAll(true);
    try {
      const r = await api.post<{ generated: number }>(`/api/staff/cases/${caseId}/sop/generate-all`, {});
      toast.success(`Generated ${r.generated} SOP${r.generated === 1 ? '' : 's'}.`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? 'Could not generate SOPs.'); }
    finally { setGenAll(false); }
  };

  return (
    <Section icon={ScrollText} title="AI-generated SOP(s)">
      {data === null ? (
        <EmptyCard>Loading…</EmptyCard>
      ) : !submitted ? (
        <EmptyCard>
          One SOP per programme choice, each tailored to that institution. Available once the client has{' '}
          <strong>submitted their programme choices</strong>.
        </EmptyCard>
      ) : choices.length === 0 ? (
        <EmptyCard>No programme choices on this application yet.</EmptyCard>
      ) : (
        <div className="space-y-3">
          {missing > 1 && (
            <div className="flex justify-end">
              <button onClick={generateAll} disabled={genAll} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
                {genAll ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate all ({missing})
              </button>
            </div>
          )}
          {[...choices].sort((a, b) => a.priority - b.priority).map((c) => (
            <SopCard key={c.choiceId} caseId={caseId} item={c} reload={load} />
          ))}
        </div>
      )}
    </Section>
  );
}

export function CaseAdmissionsTab({ data, caseId }: { data: CaseDetail; caseId: string }) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [noApplication, setNoApplication] = useState(false);
  const [rules, setRules] = useState<Rules>({ enabled: false, mandatorySlots: [] });

  useEffect(() => {
    api.get<ChoicesResp>(`/api/staff/cases/${caseId}/programme-choices`)
      .then((r) => { setChoices(r.choices); setNoApplication(false); })
      .catch(() => { setChoices([]); setNoApplication(true); }); // 404 = no admission application yet
    api.get<Rules>('/public/programme-choice-rules').then(setRules).catch(() => {});
  }, [caseId]);

  const sc = data.scorecard;
  const sorted = [...(choices ?? [])].sort((a, b) => a.priority - b.priority);
  const rulesActive = rules.enabled && rules.mandatorySlots.length > 0;

  return (
    <div className="space-y-7">
      {/* ── Score ───────────────────────────────────────────────────────── */}
      <Section icon={GraduationCap} title="Score">
        {sc ? (
          <div className="rounded-xl border border-sorena-navy/10 bg-white p-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div>
                <div className="text-3xl font-bold leading-none text-[#1e3a5f]">{sc.totalScore}</div>
                <div className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">Total score</div>
              </div>
              <span className="rounded-full bg-[#1e3a5f]/10 px-3 py-1 text-sm font-semibold text-[#1e3a5f]">{bandLabel(sc.band)}</span>
              <span className={[
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                sc.executionEligible ? 'bg-[#15a86b]/12 text-[#15803d]' : 'bg-amber-100 text-amber-700',
              ].join(' ')}>
                {sc.executionEligible ? 'Execution eligible' : 'Not execution-eligible'}
              </span>
              <span className="text-xs text-gray-500">Next action: <strong className="text-[#1e3a5f]">{humanize(sc.nextAction)}</strong></span>
              <Link href={`/staff/scorecards/${sc.submissionId}`} className="ms-auto inline-flex items-center gap-1 text-sm text-[#c9a961] hover:underline">
                View full scorecard <ExternalLink size={13} />
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {sc.categories.map((c, i) => (
                <span key={i} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                  {c.name}: <strong className="text-[#1e3a5f]">{c.score}</strong><span className="text-gray-400">/{c.max}</span>
                </span>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-gray-400">Submitted {new Date(sc.submittedAt).toLocaleDateString('en-NZ')}</div>
          </div>
        ) : (
          <EmptyCard>No scorecard on file yet for this client.</EmptyCard>
        )}
      </Section>

      {/* ── Programme choices / priority list ───────────────────────────── */}
      <Section icon={ListOrdered} title="Programme choices (priority list)">
        {rulesActive && sorted.length > 0 && (
          <div className="mb-3 rounded-xl border border-sorena-navy/10 bg-white p-3">
            <p className="mb-1.5 text-xs font-semibold text-[#1e3a5f]">Required positions</p>
            <ul className="space-y-1">
              {[...rules.mandatorySlots].sort((a, b) => a.position - b.position).map((m) => {
                const at = sorted[m.position - 1];
                const met = !!at && at.institutionType === m.institutionType;
                return (
                  <li key={m.position} className="flex items-center gap-2 text-xs">
                    {met
                      ? <Check size={14} className="shrink-0 text-[#15a86b]" />
                      : <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-amber-400" />}
                    <span className={met ? 'text-gray-600' : 'text-amber-800'}>
                      Priority {m.position} must be a <strong>{typeLabel(m.institutionType)}</strong>{met ? '' : ' — not set'}.
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {sorted.length === 0 ? (
          <EmptyCard>{noApplication ? 'No admission application started yet — no programme choices.' : 'No programme choices yet.'}</EmptyCard>
        ) : (
          <ul className="space-y-2">
            {sorted.map((c, idx) => {
              const m = rules.mandatorySlots.find((x) => x.position === idx + 1);
              const wrong = rulesActive && !!m && c.institutionType !== m.institutionType;
              return (
                <li key={c.id} className="flex items-center gap-3 rounded-xl border border-sorena-navy/10 bg-white p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1e3a5f] text-xs font-bold text-white">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#1e3a5f]">
                      {c.providerName ? `${c.providerName} — ` : ''}{c.programmeName ?? c.programmeId}
                      {c.institutionType && (
                        <span className="ms-2 rounded bg-sorena-navy/5 px-1.5 py-0.5 text-[11px] font-normal text-gray-500">{typeLabel(c.institutionType)}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">{intakeLabel(c.intakeMonth, c.intakeYear)}</p>
                    {wrong && <p className="mt-0.5 text-[11px] text-amber-700">Priority {idx + 1} must be a {typeLabel(m!.institutionType)}.</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-gray-400">Read-only view. Adjusting a client&apos;s choices from the case file (the staff swap panel) is a later step.</p>
      </Section>

      {/* ── Employment history (real, staff view/edit — PR-ADMISSION-CVDATA) ── */}
      <EmploymentSection caseId={caseId} />

      {/* ── AI-generated CV (real — PR-ADMISSION-CV) ─────────────────────── */}
      <CvSection caseId={caseId} />

      {/* ── AI-generated SOP(s) (real — PR-ADMISSION-SOP) ────────────────── */}
      <SopSection caseId={caseId} />

      {/* ── Placeholders for later steps (honest empty states) ──────────── */}
      <Placeholder icon={Award} title="Offer record" note="Offer-of-place logging (institution, conditional/unconditional, expiry, letter) lands in a later step." />
      <Placeholder icon={Send} title="Submission history" note="Per-institution submission logging (date, method, portal, response, outcome) lands in a later step." />
    </div>
  );
}
