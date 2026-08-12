'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Loader2, Send, AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-COMMISSION-TRIGGER — the Admission Officer's half of the commission claim.
//
// Two sections, in the order the work happens: confirm the student turned up,
// then submit the claim once the fortnight has passed. Both are queues rather
// than something to remember on a particular day — the Manual's "2 weeks after
// first-class attendance" is the reason this page exists, and a rule nobody can
// see is a rule nobody follows.

const MONTH = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface AwaitingRow {
  programmeChoiceId: string;
  caseId: string | null;
  clientId: string | null;
  studentName: string | null;
  programmeName: string | null;
  providerName: string | null;
  intakeMonth: number;
  intakeYear: number;
}

interface EligibleRow {
  programmeChoiceId: string;
  caseId: string | null;
  clientId: string | null;
  studentName: string | null;
  programmeName: string | null;
  providerName: string | null;
  firstClassAttendedAt: string | null;
  eligibleSince: string | null;
  previouslyRejected: { reason: string | null; decidedAt: string | null } | null;
}

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

export function CommissionTriggersClient() {
  const [awaiting, setAwaiting] = useState<AwaitingRow[] | null>(null);
  const [eligible, setEligible] = useState<EligibleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<AwaitingRow[]>('/staff/commission-triggers/awaiting-attendance'),
      api.get<EligibleRow[]>('/staff/commission-triggers/eligible'),
    ])
      .then(([a, e]) => { setAwaiting(a); setEligible(e); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Couldn’t load your commission triggers.'));
  }, []);
  useEffect(load, [load]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ kind: 'ok', text: ok }); load(); }
    catch (e) {
      const raw = (e as any)?.body?.message ?? (e as Error)?.message;
      setMsg({ kind: 'err', text: (Array.isArray(raw) ? raw[0] : raw) || 'That didn’t work.' });
    } finally { setBusy(null); }
  }

  const confirmAttended = (r: AwaitingRow) =>
    run(r.programmeChoiceId,
      () => api.post(`/staff/cases/${r.caseId}/programme-choices/${r.programmeChoiceId}/first-class-attended`, {}),
      `First class recorded for ${r.studentName ?? 'the student'}.`);

  const submit = (r: EligibleRow) =>
    run(r.programmeChoiceId,
      () => api.post('/staff/commission-triggers', { programmeChoiceId: r.programmeChoiceId }),
      'Commission trigger submitted — Finance will review it.');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-sorena-navy">Commission triggers</h1>
        <p className="mt-1 text-sm text-sorena-text/70">
          Confirm when a student starts classes, then claim the commission two weeks later. Finance approves each claim.
        </p>
      </div>

      {msg && (
        <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${msg.kind === 'ok'
          ? 'border border-sorena-jade/30 bg-sorena-jade/10 text-sorena-jade'
          : 'border border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!awaiting && !error && (
        <div className="flex items-center gap-2 py-12 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      )}

      {eligible && (
        <section className="mb-8">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-sorena-navy">
            <Send size={15} /> Ready to claim ({eligible.length})
          </h2>
          <p className="mb-3 text-xs text-sorena-text/60">Two weeks have passed since the first class.</p>
          {eligible.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-sorena-text/60">
              Nothing ready to claim yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {eligible.map((r) => (
                <li key={r.programmeChoiceId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sorena-navy">
                        {r.studentName ?? 'Unknown student'}
                        {r.clientId && <code className="ml-2 font-mono text-[11px] text-sorena-text/45">{r.clientId}</code>}
                      </p>
                      <p className="mt-0.5 text-sm text-sorena-text/70">{r.providerName ?? '—'} · {r.programmeName ?? '—'}</p>
                      <p className="mt-0.5 text-xs text-sorena-text/50">
                        First class {day(r.firstClassAttendedAt)} · claimable since {day(r.eligibleSince)}
                      </p>
                      {r.previouslyRejected && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <AlertCircle size={13} className="mt-0.5 shrink-0" />
                          <span>Previously declined: “{r.previouslyRejected.reason}” — fix this before re-submitting.</span>
                        </p>
                      )}
                    </div>
                    <button type="button" disabled={busy === r.programmeChoiceId} onClick={() => submit(r)}
                      className="shrink-0 rounded-lg bg-sorena-navy px-3 py-2 text-sm font-bold text-white hover:bg-[#162d49] disabled:opacity-50">
                      {busy === r.programmeChoiceId ? 'Submitting…' : 'Submit claim'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {awaiting && (
        <section>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-sorena-navy">
            <CalendarCheck size={15} /> Awaiting first class ({awaiting.length})
          </h2>
          <p className="mb-3 text-xs text-sorena-text/60">Confirm the day the student actually started — the two-week clock runs from there.</p>
          {awaiting.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-sorena-text/60">
              Nothing waiting on a start date.
            </p>
          ) : (
            <ul className="space-y-2">
              {awaiting.map((r) => (
                <li key={r.programmeChoiceId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sorena-navy">
                        {r.studentName ?? 'Unknown student'}
                        {r.clientId && <code className="ml-2 font-mono text-[11px] text-sorena-text/45">{r.clientId}</code>}
                      </p>
                      <p className="mt-0.5 text-sm text-sorena-text/70">{r.providerName ?? '—'} · {r.programmeName ?? '—'}</p>
                      <p className="mt-0.5 text-xs text-sorena-text/50">Intake {MONTH[r.intakeMonth] ?? r.intakeMonth} {r.intakeYear}</p>
                    </div>
                    <button type="button" disabled={busy === r.programmeChoiceId} onClick={() => confirmAttended(r)}
                      className="shrink-0 rounded-lg border border-sorena-navy/20 px-3 py-2 text-sm font-semibold text-sorena-navy hover:bg-sorena-navy/5 disabled:opacity-50">
                      {busy === r.programmeChoiceId ? 'Saving…' : 'Confirm first class today'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
