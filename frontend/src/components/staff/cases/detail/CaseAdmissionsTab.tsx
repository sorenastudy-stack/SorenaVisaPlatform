'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  GraduationCap, ListOrdered, FileText, ScrollText, Award, Send,
  ExternalLink, Check, type LucideIcon,
} from 'lucide-react';
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
              {sc.categoryScores.map((v, i) => (
                <span key={i} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                  Category {i + 1}: <strong className="text-[#1e3a5f]">{v}</strong>
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

      {/* ── Placeholders for later steps (honest empty states) ──────────── */}
      <Placeholder icon={FileText} title="AI-generated CV" note="The CV generation + Admission Specialist review/approve flow lands in a later step." />
      <Placeholder icon={ScrollText} title="AI-generated SOP(s)" note="Per-institution SOP generation + the three quality gates land in a later step." />
      <Placeholder icon={Award} title="Offer record" note="Offer-of-place logging (institution, conditional/unconditional, expiry, letter) lands in a later step." />
      <Placeholder icon={Send} title="Submission history" note="Per-institution submission logging (date, method, portal, response, outcome) lands in a later step." />
    </div>
  );
}
