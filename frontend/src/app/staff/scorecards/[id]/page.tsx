import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ClipboardList, AlertTriangle, Lock, CheckCircle2, XCircle,
  Gauge, ListChecks, Briefcase, ArrowRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { apiServer, ApiServerError } from '@/lib/apiServer';

// PR-SCORECARD-1 — Staff scorecard detail view.

interface HardStopOut {
  code: string;
  name: string;
  reason: string;
  resolution: string;
}

interface PerFieldScore {
  answer: string;
  points: number;
}

interface ScorecardDetail {
  submissionId: string;
  totalScore: number;
  band: 'BAND_1' | 'BAND_2' | 'BAND_3' | 'BAND_4' | 'BAND_5' | 'BAND_6';
  bandName: string;
  bandRange: string;
  categoryScores: Record<number, number>;
  hardStops: HardStopOut[];
  riskFlags: string[];
  executionEligible: boolean;
  // Fix 5 (PR-SCORECARD-2 follow-up): gateResults is now a server-
  // sorted array (Gate 1 → Gate 5) rather than an object.
  gateResults: Array<{ gateNumber: 1 | 2 | 3 | 4 | 5; label: string; passed: boolean }>;
  nextAction: string;
  nextActionTextEn: string;
  nextActionTextFa: string;
  answers?: Record<string, string>;
  perFieldScores?: Record<string, PerFieldScore>;
  submittedAt: string;
  leadId: string | null;
  consultationBookedAt: string | null;
  lead: { id: string; contactId: string } | null;
}

const CATEGORY_LABELS: Record<number, { name: string; max: number }> = {
  1: { name: 'Profile & Migration Stability',         max: 20 },
  2: { name: 'Academic & Career Foundation',          max: 35 },
  3: { name: 'Financial & Operational Readiness',     max: 25 },
  4: { name: 'Immigration & Risk Assessment',         max: 20 },
};

const FIELD_TO_CATEGORY: Record<string, 1 | 2 | 3 | 4> = {
  q01_motivation: 1, q02_migrate_before_family: 1, q03_age: 1, q05_military: 1,
  q06_marital: 1, q07_marriage_years: 1, q08_children: 1, q09_partner_age: 1,
  q10_partner_edu: 1, q11_partner_english: 1, q12_other_citizenship: 1,
  q13_travel_history: 1, q14_visa_countries_type: 1,
  q15_highest_qual: 2, q16_field_main: 2, q17_gpa: 2, q18_years_since: 2,
  q19_docs_translated: 2, q20_publications: 2, q21_english_cert: 2,
  q22_english_score: 2, q24_studied_english: 2, q26_field_change: 2,
  q27_study_goal: 2, q28_work_after_grad: 2, q29_years_work: 2,
  q30_work_relevance: 2, q31_occupation: 2,
  q33_funds: 3, q34_funds_source: 3, q35_overseas_bank: 3, q36_financial_docs: 3,
  q37_overseas_contacts: 3, q38_settlement_support: 3, q39_passport: 3,
  q40_docs_ready: 3, q41_apply_timeline: 3,
  q44_refusal: 4, q45_refusal_count: 4, q46_refusal_recency: 4, q47_medical: 4,
  q48_police_clearance: 4, q49_breach: 4, q50_other_identity: 4,
  q51_self_submitted: 4, q52_other_agent: 4,
};

export default async function ScorecardDetailPage({ params }: { params: { id: string } }) {
  let data: ScorecardDetail | null = null;
  let errorMsg: string | null = null;
  try {
    data = await apiServer.get<ScorecardDetail>(`/staff/scorecard/${params.id}`);
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 404) notFound();
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load scorecard.';
  }
  if (errorMsg || !data) {
    return (
      <div className="max-w-4xl">
        <Link href="/staff/scorecards" className="text-sm text-[#1E3A5F] hover:text-[#E8B923]">← Back to scorecards</Link>
        <Card className="border-red-200 bg-red-50 mt-4">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg ?? 'Scorecard unavailable.'}</CardContent>
        </Card>
      </div>
    );
  }

  const applicantName = data.answers?.full_name ?? '(unknown applicant)';

  return (
    <div className="max-w-5xl">
      <Link href="/staff/scorecards" className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:text-[#E8B923] mb-4">
        ← Back to scorecards
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <ClipboardList size={22} className="text-[#E8B923]" />
            {applicantName}
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Submitted {new Date(data.submittedAt).toLocaleString('en-NZ')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BandBadge band={data.band} label={`${data.band.replace('BAND_', 'Band ')} — ${data.bandName}`} />
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold bg-[#1E3A5F] text-white">
            {data.totalScore} / 100
          </span>
          {data.executionEligible ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              <CheckCircle2 size={12} /> Execution eligible
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 border border-gray-200">
              <XCircle size={12} /> Not yet eligible
            </span>
          )}
        </div>
      </div>

      {/* Category breakdown */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-4 flex items-center gap-2">
            <Gauge size={14} /> Category breakdown
          </h2>
          <div className="space-y-3">
            {[1, 2, 3, 4].map((cat) => {
              const meta = CATEGORY_LABELS[cat];
              const score = data!.categoryScores[cat] ?? 0;
              const pct = Math.round((score / meta.max) * 100);
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-semibold text-[#1E3A5F]">{meta.name}</span>
                    <span className="font-mono text-[#4A4A4A]">{score} / {meta.max} ({pct}%)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-[#E8B923]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Hard stops */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3 flex items-center gap-2">
            <Lock size={14} /> Hard stops
            <span className="ml-1 text-xs font-medium">{data.hardStops.length} active</span>
          </h2>
          {data.hardStops.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 italic py-2">None. No execution-blocking conditions detected.</p>
          ) : (
            <ul className="space-y-3">
              {data.hardStops.map((h) => (
                <li key={h.code} className="rounded-xl border-2 border-red-200 bg-red-50/50 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-red-700 text-white">{h.code}</span>
                    <span className="font-bold text-red-900">{h.name}</span>
                  </div>
                  <p className="text-sm text-red-800 mb-1">{h.reason}</p>
                  <p className="text-xs text-red-900/80"><strong>Resolution:</strong> {h.resolution}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Risk flags */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3 flex items-center gap-2">
            <AlertTriangle size={14} /> Risk flags
            <span className="ml-1 text-xs font-medium">{data.riskFlags.length}</span>
          </h2>
          {data.riskFlags.length === 0 ? (
            <p className="text-sm text-[#4A4A4A]/60 italic py-2">None. Standard handling.</p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {data.riskFlags.map((f) => (
                <span key={f} className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                  {f}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5-gate check */}
      <Card className="mb-6">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-3 flex items-center gap-2">
            <ListChecks size={14} /> Execution eligibility — 5-gate check
          </h2>
          <ul className="space-y-1">
            {data.gateResults.map((g) => (
              <li key={g.gateNumber} className="flex items-center gap-2 text-sm">
                {g.passed
                  ? <CheckCircle2 size={14} className="text-emerald-600" />
                  : <XCircle size={14} className="text-red-600" />}
                <span className="text-[#1E3A5F]">{g.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
            <strong className={data.executionEligible ? 'text-emerald-700' : 'text-gray-500'}>
              Overall: {data.executionEligible ? 'ELIGIBLE FOR EXECUTION' : 'NOT YET ELIGIBLE'}
            </strong>
          </div>
        </CardContent>
      </Card>

      {/* Next action */}
      <Card className="mb-6 border-[#E8B923]/40 bg-[#E8B923]/5">
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#1E3A5F]/70 mb-2">Next best action</h2>
          <p className="text-base text-[#1E3A5F] font-semibold leading-relaxed">{data.nextActionTextEn}</p>
          <p className="text-sm text-[#4A4A4A]/70 mt-2 leading-relaxed" dir="rtl">{data.nextActionTextFa}</p>
          <div className="mt-3 text-xs text-[#4A4A4A]/60">
            Code: <code className="font-mono">{data.nextAction}</code>
          </div>
        </CardContent>
      </Card>

      {/* Linked lead */}
      {data.lead && (
        <Card className="mb-6">
          <CardContent>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-2 flex items-center gap-2">
              <Briefcase size={14} /> Linked CRM lead
            </h2>
            <div className="text-sm text-[#1E3A5F]">
              Lead ID: <code className="font-mono">{data.lead.id}</code>
            </div>
            <Link
              href={`/sales/leads/${data.lead.id}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#E8B923] mt-2"
            >
              Open lead <ArrowRight size={12} />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Full answer log */}
      {data.answers && data.perFieldScores && (
        <Card>
          <CardContent>
            <h2 className="text-lg font-bold text-[#1E3A5F] mb-4">Full answer log</h2>
            <div className="space-y-5">
              {[1, 2, 3, 4].map((cat) => {
                const meta = CATEGORY_LABELS[cat];
                const fields = Object.keys(FIELD_TO_CATEGORY).filter((f) => FIELD_TO_CATEGORY[f] === cat);
                return (
                  <div key={cat}>
                    <h3 className="text-sm font-bold text-[#1E3A5F] mb-2 pb-1 border-b border-gray-100">
                      Category {cat}: {meta.name} — {data!.categoryScores[cat]} / {meta.max}
                    </h3>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-50">
                        {fields.map((f) => {
                          const pf = data!.perFieldScores![f];
                          return (
                            <tr key={f}>
                              <td className="py-1.5 pr-3 text-xs font-mono text-[#4A4A4A]/70 align-top w-40">{f}</td>
                              <td className="py-1.5 px-3 text-[#1E3A5F] align-top">{pf?.answer ?? '(not answered)'}</td>
                              <td className="py-1.5 pl-3 text-right text-xs font-mono text-[#4A4A4A] align-top whitespace-nowrap">+{pf?.points ?? 0} pts</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BandBadge({ band, label }: { band: ScorecardDetail['band']; label: string }) {
  const styles: Record<ScorecardDetail['band'], string> = {
    BAND_1: 'bg-gray-100 text-gray-700 border border-gray-200',
    BAND_2: 'bg-blue-50 text-blue-800 border border-blue-200',
    BAND_3: 'bg-amber-50 text-amber-800 border border-amber-200',
    BAND_4: 'bg-orange-50 text-orange-800 border border-orange-200',
    BAND_5: 'bg-violet-50 text-violet-800 border border-violet-200',
    BAND_6: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold ${styles[band]}`}>
      {label}
    </span>
  );
}
