'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, Loader2, ClipboardCheck, MapPin, Wallet, CalendarDays,
  RefreshCw, ExternalLink, Sparkles, PencilLine,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-CATALOG-2 — the Owner's ONE review queue over three PENDING kinds:
//   programmes  — Excel-imported, awaiting first approval (PR-CATALOG-1).
//   changes     — field changes the monthly web check found on an approved programme.
//   candidates  — new programmes the web check discovered.
// Per-item Approve / Reject (no bulk). Nothing is visible to students until approved.

interface Prov { id: string; name: string; status: string; institutionType: string | null }
interface Pending {
  id: string; name: string; level: string | null; nzqfLevel: string | null;
  campusCity: string | null; tuitionFeeNZD: number | null; currency: string | null;
  source: string; intakeCount: number; provider: Prov; studyField: { key: string; nameEn: string } | null;
}
interface Change {
  id: string; programmeName: string; campusCity: string | null; nzqfLevel: string | null;
  changedFields: Record<string, { from: unknown; to: unknown }>; sourceUrl: string | null;
  detectedAt: string; provider: Prov;
}
interface Candidate {
  id: string; name: string; level: string | null; nzqfLevel: string | null; campusCity: string | null;
  tuitionFeeNZD: number | null; studyFieldKey: string | null; detectedFields: string[];
  confidence: number | null; sourceUrl: string | null; detectedAt: string; provider: Prov;
}
interface Queue { programmes: Pending[]; changes: Change[]; candidates: Candidate[] }

const INSTITUTION_LABEL: Record<string, string> = { UNIVERSITY: 'University', ITP: 'Polytechnic', PTE: 'College' };
const SOURCE_LABEL: Record<string, string> = { MANUAL_EXCEL: 'Excel import', MANUAL_ENTRY: 'Manual', AUTOMATED_WEB_CHECK: 'Web check' };
const FIELD_LABEL: Record<string, string> = {
  tuitionFeeNZD: 'Tuition fee (NZD)', nzqfLevel: 'NZQF level', durationMonths: 'Duration (months)',
  campusCity: 'Campus', qualificationType: 'Qualification type',
};
const fmt = (v: unknown): string => {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('en-NZ');
  return String(v).replace('LEVEL_', 'L');
};
const nzqf = (v: string | null) => (v ? v.replace('LEVEL_', 'L') : null);

function ProviderLine({ p }: { p: Prov }) {
  return (
    <p className="mt-0.5 text-xs text-gray-500">
      {p.name}
      {p.institutionType ? ` · ${INSTITUTION_LABEL[p.institutionType] ?? p.institutionType}` : ''}
      {' · '}
      <span className={p.status === 'ACTIVE' ? 'text-[#15a86b] font-medium' : 'text-amber-700 font-medium'}>
        institution {p.status}
      </span>
    </p>
  );
}

export function ProgrammeApprovalsClient() {
  const [q, setQ] = useState<Queue | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setQ(null); setError(false);
    api.get<Queue>('/providers/review-queue').then(setQ).catch(() => setError(true));
  };
  useEffect(load, []);

  // path builds the correct endpoint per kind; on success drop the row from its list.
  const act = async (
    kind: 'programme' | 'change' | 'candidate',
    id: string,
    action: 'approve' | 'reject',
  ) => {
    const path =
      kind === 'programme' ? `/providers/programmes/${id}/${action}`
        : kind === 'change' ? `/providers/change-proposals/${id}/${action}`
          : `/providers/candidates/${id}/${action}`;
    setBusy(id);
    try {
      await api.patch(path, {});
      setQ((cur) => {
        if (!cur) return cur;
        return {
          programmes: kind === 'programme' ? cur.programmes.filter((x) => x.id !== id) : cur.programmes,
          changes: kind === 'change' ? cur.changes.filter((x) => x.id !== id) : cur.changes,
          candidates: kind === 'candidate' ? cur.candidates.filter((x) => x.id !== id) : cur.candidates,
        };
      });
      toast.success(
        action === 'reject' ? 'Rejected.'
          : kind === 'change' ? 'Change applied to the live programme.'
            : 'Approved — now visible to students (if the institution is Active).',
      );
    } catch (e: any) {
      toast.error(e?.message ?? 'Action failed.');
    } finally { setBusy(null); }
  };

  const Actions = ({ kind, id }: { kind: 'programme' | 'change' | 'candidate'; id: string }) => (
    <div className="flex shrink-0 gap-2">
      <button onClick={() => act(kind, id, 'approve')} disabled={busy === id}
        className="inline-flex items-center gap-1.5 rounded-xl bg-[#1e3a5f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50">
        {busy === id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approve
      </button>
      <button onClick={() => act(kind, id, 'reject')} disabled={busy === id}
        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
        <XCircle size={13} /> Reject
      </button>
    </div>
  );

  const total = q ? q.programmes.length + q.changes.length + q.candidates.length : 0;

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center gap-2.5">
        <ClipboardCheck className="text-[#1e3a5f]" size={22} />
        <div>
          <h1 className="text-lg font-bold text-[#1e3a5f]">Programme approvals</h1>
          <p className="text-xs text-gray-500">Review each item before it reaches students. Imports, web-detected changes, and newly-discovered programmes all land here — nothing is published without your approval.</p>
        </div>
        {q && <button onClick={load} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50"><RefreshCw size={13} /> Refresh</button>}
      </div>

      {error && <Card><CardContent className="p-6 text-center text-sm text-red-600">Couldn’t load the queue. <button onClick={load} className="underline">Try again</button></CardContent></Card>}
      {!q && !error && <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#c9a961]" /></div>}
      {q && total === 0 && (
        <Card><CardContent className="p-10 text-center text-sm text-gray-500">Nothing waiting for review. Imported programmes and the monthly web check’s findings will appear here.</CardContent></Card>
      )}

      {/* Pending programmes (Excel import) */}
      {q && q.programmes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[#1e3a5f]">Imported programmes <span className="text-gray-400 font-normal">· {q.programmes.length}</span></h2>
          <ul className="space-y-3">
            {q.programmes.map((p) => (
              <li key={p.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-[#1e3a5f]">{p.name}</p>
                      <span className="rounded-full bg-[#c9a961]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a6d10]">{SOURCE_LABEL[p.source] ?? p.source}</span>
                    </div>
                    <ProviderLine p={p.provider} />
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                      {p.studyField && <span className="rounded bg-gray-100 px-1.5 py-0.5">{p.studyField.nameEn}</span>}
                      {p.level && <span>{p.level}</span>}
                      {p.nzqfLevel && <span className="text-gray-400">NZQF {nzqf(p.nzqfLevel)}</span>}
                      {p.campusCity && <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" />{p.campusCity}</span>}
                      {p.tuitionFeeNZD != null && <span className="inline-flex items-center gap-1"><Wallet size={12} className="text-gray-400" />{(p.currency ?? 'NZD')} {p.tuitionFeeNZD.toLocaleString('en-NZ')}</span>}
                      <span className="inline-flex items-center gap-1"><CalendarDays size={12} className="text-gray-400" />{p.intakeCount} intake{p.intakeCount === 1 ? '' : 's'}</span>
                    </div>
                    {p.provider.status !== 'ACTIVE' && <p className="mt-2 text-[11px] text-amber-700">Approving won’t show this to students until the institution is set Active.</p>}
                  </div>
                  <Actions kind="programme" id={p.id} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Field-change proposals */}
      {q && q.changes.length > 0 && (
        <section className="space-y-3">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1e3a5f]"><PencilLine size={15} /> Detected changes <span className="text-gray-400 font-normal">· {q.changes.length}</span></h2>
          <p className="text-xs text-gray-500">The monthly web check found these differences on an already-approved programme’s page. Approving applies the change to the live programme.</p>
          <ul className="space-y-3">
            {q.changes.map((c) => (
              <li key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#1e3a5f]">{c.programmeName}</p>
                    <ProviderLine p={c.provider} />
                    <div className="mt-2 space-y-1">
                      {Object.entries(c.changedFields).map(([field, v]) => (
                        <div key={field} className="text-xs text-gray-700">
                          <span className="text-gray-500">{FIELD_LABEL[field] ?? field}: </span>
                          <span className="text-gray-400 line-through">{fmt(v.from)}</span>
                          <span className="mx-1.5 text-gray-400">→</span>
                          <span className="font-semibold text-[#1e3a5f]">{fmt(v.to)}</span>
                        </div>
                      ))}
                    </div>
                    {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#c9a961] hover:underline"><ExternalLink size={11} /> source page</a>}
                  </div>
                  <Actions kind="change" id={c.id} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* New-programme candidates */}
      {q && q.candidates.length > 0 && (
        <section className="space-y-3">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1e3a5f]"><Sparkles size={15} /> Discovered programmes <span className="text-gray-400 font-normal">· {q.candidates.length}</span></h2>
          <p className="text-xs text-gray-500">Possible new programmes the web check found that aren’t in the catalogue yet. AI-extracted — check the details against the source before approving. Approving creates the programme.</p>
          <ul className="space-y-3">
            {q.candidates.map((c) => {
              const conf = c.confidence == null ? null : Math.round(c.confidence * 100);
              const confClass = conf == null ? '' : conf >= 80 ? 'bg-[#15a86b]/15 text-[#15803d]' : 'bg-amber-100 text-amber-700';
              return (
                <li key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-[#1e3a5f]">{c.name}</p>
                        {conf != null && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${confClass}`}>{conf}% confidence</span>}
                      </div>
                      <ProviderLine p={c.provider} />
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                        {c.level && <span>{c.level}</span>}
                        {c.nzqfLevel && <span className="text-gray-400">NZQF {nzqf(c.nzqfLevel)}</span>}
                        {c.campusCity && <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" />{c.campusCity}</span>}
                        {c.tuitionFeeNZD != null && <span className="inline-flex items-center gap-1"><Wallet size={12} className="text-gray-400" />NZD {c.tuitionFeeNZD.toLocaleString('en-NZ')}</span>}
                      </div>
                      {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#c9a961] hover:underline"><ExternalLink size={11} /> source page</a>}
                    </div>
                    <Actions kind="candidate" id={c.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
