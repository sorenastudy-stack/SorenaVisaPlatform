'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BadgeCheck, Banknote, Loader2, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-AGENT-PAYABLES (phase 2) — the two decisions on an agent's share.
//
// One component, two queues, because they differ only in which decision they
// offer: Finance agrees a share is owed, and the Owner releases it. The split
// is not presentational — the server refuses a release by whoever approved it,
// so a person holding both roles still cannot pay themselves through.

interface PayableRow {
  id: string;
  agentId: string;
  agentName: string | null;
  studentName: string | null;
  providerName: string | null;
  programmeName: string | null;
  amountMinorUnits: number;
  currency: string;
  ratePercent: number;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/** Same shape as the accounting dashboard's — one unit for every currency. */
const money = (currency: string, minorUnits: number) =>
  `${currency} ${(minorUnits / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

export function AgentPayoutsClient({ mode, viewerId }: { mode: 'approve' | 'release'; viewerId: string }) {
  const [rows, setRows] = useState<PayableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const path = mode === 'approve' ? '/staff/agent-payables/pending' : '/staff/agent-payables/awaiting-release';

  const load = useCallback(() => {
    api.get<PayableRow[]>(path)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Couldn’t load the payout queue.'));
  }, [path]);
  useEffect(load, [load]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ kind: 'ok', text: ok }); setRejecting(null); setReason(''); load(); }
    catch (e) {
      const raw = (e as any)?.body?.message ?? (e as Error)?.message;
      setMsg({ kind: 'err', text: (Array.isArray(raw) ? raw[0] : raw) || 'That didn’t work.' });
    } finally { setBusy(null); }
  }

  const approve = (r: PayableRow) =>
    run(r.id, () => api.patch(`/staff/agent-payables/${r.id}/approve`, {}),
      `Approved ${money(r.currency, r.amountMinorUnits)} for ${r.agentName ?? 'the agent'} — the Owner releases it.`);

  const reject = (r: PayableRow) =>
    run(r.id, () => api.patch(`/staff/agent-payables/${r.id}/reject`, { reason }),
      `Marked not owed. The reason is kept on the record.`);

  const release = (r: PayableRow) =>
    run(r.id, () => api.patch(`/staff/agent-payables/${r.id}/release`, {}),
      `Released ${money(r.currency, r.amountMinorUnits)} to ${r.agentName ?? 'the agent'}.`);

  const title = mode === 'approve' ? 'Agent payouts to approve' : 'Agent payouts to release';
  const blurb = mode === 'approve'
    ? 'A share of a commission Sorena has earned, owed to the agent who introduced the client. Approving says the debt is real; a second person releases the money.'
    : 'Finance has agreed these are owed. Releasing one records that the money went out — and you cannot release a payout you approved yourself.';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-sorena-navy">{title}</h1>
        <p className="mt-1 text-sm text-sorena-text/70">{blurb}</p>
      </div>

      {msg && (
        <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${msg.kind === 'ok'
          ? 'border border-sorena-jade/30 bg-sorena-jade/10 text-sorena-jade'
          : 'border border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!rows && !error && (
        <div className="flex items-center gap-2 py-12 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {rows && rows.length === 0 && (
        <p className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-sorena-text/60">
          {mode === 'approve'
            ? 'Nothing waiting. A payout appears here when Sorena earns a commission on a client an agent introduced.'
            : 'Nothing waiting on you. Approved payouts appear here for release.'}
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const selfApproved = mode === 'release' && r.approvedById === viewerId;
            return (
              <li key={r.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sorena-navy">{r.agentName ?? 'Unknown agent'}</p>
                    <p className="mt-0.5 text-sm text-sorena-text/70">
                      {r.studentName ?? '—'} · {r.providerName ?? '—'}
                      {r.programmeName ? ` · ${r.programmeName}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-sorena-text/50">
                      {r.ratePercent}% share · raised {day(r.createdAt)}
                      {r.approvedByName && ` · approved by ${r.approvedByName} on ${day(r.approvedAt)}`}
                    </p>
                    {selfApproved && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span>You approved this one, so somebody else has to release it — two people, always.</span>
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-lg font-bold text-sorena-navy tabular-nums">
                      {money(r.currency, r.amountMinorUnits)}
                    </span>
                    {mode === 'approve' ? (
                      <>
                        <button type="button" disabled={busy === r.id} onClick={() => approve(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-sorena-navy px-3 py-2 text-sm font-bold text-white hover:bg-[#162d49] disabled:opacity-50">
                          <BadgeCheck size={15} /> Approve
                        </button>
                        <button type="button" disabled={busy === r.id}
                          onClick={() => { setRejecting(rejecting === r.id ? null : r.id); setReason(''); }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-sorena-text/80 hover:bg-gray-50 disabled:opacity-50">
                          <XCircle size={15} /> Not owed
                        </button>
                      </>
                    ) : (
                      <button type="button" disabled={busy === r.id || selfApproved} onClick={() => release(r)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sorena-jade px-3 py-2 text-sm font-bold text-white hover:brightness-95 disabled:opacity-40"
                        title={selfApproved ? 'You approved this payout — a different person must release it' : undefined}>
                        <Banknote size={15} /> Release
                      </button>
                    )}
                  </div>
                </div>

                {rejecting === r.id && (
                  <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <label className="block text-xs font-semibold text-sorena-navy" htmlFor={`reason-${r.id}`}>
                      Why is this not owed?
                    </label>
                    <p className="mb-2 mt-0.5 text-xs text-sorena-text/60">
                      Kept on the record — this is what a reconciliation months from now will read.
                    </p>
                    <textarea id={`reason-${r.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="e.g. the provider clawed the commission back" />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => { setRejecting(null); setReason(''); }}
                        className="rounded-lg px-3 py-1.5 text-sm text-sorena-text/70 hover:bg-gray-100">Cancel</button>
                      <button type="button" disabled={busy === r.id || reason.trim().length < 3} onClick={() => reject(r)}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40">
                        Mark not owed
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
