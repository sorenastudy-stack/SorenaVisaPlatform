'use client';

import { useEffect, useState } from 'react';
import { Loader2, Pencil, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

// PR-PHASE40 — the USD→NZD rate every invoice is stamped with.
//
// Entered by hand, by the same people who reconcile the GST. Nothing fetches it
// from a provider, so this card is the ONLY way the number changes — which is
// why it states plainly what setting it does, and shows the trail of who set
// what before.
//
// GET/POST /staff/finance/exchange-rate (FINANCE/OWNER, backend-enforced).

interface RateEntry {
  id: string;
  rate: number;
  rateDate: string;
  source: string;
  enteredByName: string | null;
  createdAt: string;
}

interface RateView {
  base: string;
  quote: string;
  current: RateEntry | null;
  history: RateEntry[];
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** How a row describes its own origin — the seeded row must not claim a person set it. */
function attribution(e: RateEntry): string {
  if (e.enteredByName) return `${e.enteredByName} · ${when(e.createdAt)}`;
  return `${e.source} · ${when(e.createdAt)}`;
}

export function ExchangeRateCard() {
  const [view, setView] = useState<RateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function load() {
    setError(null);
    try {
      setView(await api.get<RateView>('/staff/finance/exchange-rate'));
    } catch (e: any) {
      setError(e?.message ?? 'Couldn’t load the exchange rate.');
    }
  }

  useEffect(() => { load(); }, []);

  const pair = view ? `${view.base} → ${view.quote}` : 'USD → NZD';

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sorena-navy/70">
            <RefreshCw size={16} />
            <span className="text-xs font-bold uppercase tracking-wide">Exchange rate · {pair}</span>
          </div>
          <p className="mt-2 max-w-xl text-xs text-sorena-text/60">
            Used to state NZ GST in {view?.quote ?? 'NZD'} on invoices issued in {view?.base ?? 'USD'}.
            Set it here whenever you want to — it keeps applying to new invoices until you change it.
            Invoices already issued keep the rate they were stamped with.
          </p>
        </div>
        {view && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-sorena-navy px-3 py-1.5 text-sm font-medium text-sorena-navy hover:bg-sorena-navy/5"
          >
            <Pencil size={13} /> {view.current ? 'Update rate' : 'Set rate'}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!view && !error && (
        <div className="flex items-center gap-2 py-6 text-sorena-text/60">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {view && !editing && (
        <>
          {view.current ? (
            <div className="mt-4">
              <p className="text-4xl font-bold tracking-tight tabular-nums text-sorena-navy">
                {view.current.rate}
              </p>
              <p className="mt-1 text-xs text-sorena-text/60">Set by {attribution(view.current)}</p>
            </div>
          ) : (
            // Day zero. Stated as a blocker rather than a blank, because invoicing
            // genuinely stops until someone acts on it.
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              No rate has been set yet. Invoices cannot be issued until one is.
            </p>
          )}

          {view.history.length > 1 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowHistory((s) => !s)}
                className="text-xs font-semibold text-sorena-navy hover:underline"
              >
                {showHistory ? 'Hide' : 'Show'} previous rates ({view.history.length - 1})
              </button>
              {showHistory && (
                <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
                  {view.history.slice(1).map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-xs">
                      <span className="font-mono tabular-nums text-sorena-navy">{e.rate}</span>
                      <span className="text-sorena-text/60">{attribution(e)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {view && editing && (
        <RateEditor
          current={view.current?.rate ?? null}
          onCancel={() => setEditing(false)}
          onSaved={(next) => { setView(next); setEditing(false); setShowHistory(false); }}
        />
      )}
    </div>
  );
}

function RateEditor({
  current, onCancel, onSaved,
}: {
  current: number | null;
  onCancel: () => void;
  onSaved: (next: RateView) => void;
}) {
  const [value, setValue] = useState(current != null ? String(current) : '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Matches exchange_rates.rate — Decimal(12,6). More places than this are not
  // stored, they are rounded away by Postgres, so the form refuses them here
  // rather than reporting a save of a number the invoices would not carry.
  const MAX_DECIMALS = 6;

  const parsed = Number(value);
  const trimmed = value.trim();
  const decimals = trimmed.includes('.') ? trimmed.split('.')[1].replace(/[^0-9]/g, '').length : 0;

  // The reason the field is not valid, in the order a person meets them. Null
  // when it is fine. Checked before the request so the answer is immediate and
  // in our words — the backend enforces the same rules for callers that skip
  // this form.
  function problem(): string | null {
    if (trimmed === '') return 'Enter a rate.';
    if (!Number.isFinite(parsed)) return 'Enter a number — digits and a decimal point only.';
    if (parsed <= 0) return 'The rate must be greater than zero.';
    if (parsed < 0.01) return 'The rate must be at least 0.01.';
    if (parsed > 1000) return 'The rate must be 1000 or less.';
    if (decimals > MAX_DECIMALS) {
      return `Enter a rate with up to ${MAX_DECIMALS} decimal places — ${trimmed} has ${decimals}.`;
    }
    return null;
  }
  const issue = problem();
  const valid = issue === null;
  // Shown as soon as the reader has typed something we cannot accept. Not
  // gated behind pressing Save: the button is disabled while invalid, so
  // waiting for a click would mean the field silently stops working and never
  // says why — which is how the original error was found, one layer up.
  const liveMessage = err ?? (value.trim() !== '' && issue ? issue : null);

  async function save() {
    setErr(null);
    const p = problem();
    if (p) { setErr(p); return; }
    setSaving(true);
    try {
      onSaved(await api.post<RateView>('/staff/finance/exchange-rate', { rate: parsed }));
    } catch (e: any) {
      // Nest returns DTO failures as an ARRAY of messages, which stringifies to
      // a comma-joined blob. Take the first — they are written as whole
      // sentences — rather than showing the reader a joined list.
      const raw = e?.body?.message ?? e?.message;
      setErr(
        (Array.isArray(raw) ? raw[0] : raw) || 'Couldn’t save the rate.',
      );
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div>
        <label htmlFor="fx-rate" className="mb-1 block text-xs font-semibold text-sorena-navy">
          New rate — NZD per 1 USD
        </label>
        <input
          id="fx-rate"
          type="number"
          step="0.000001"
          min="0.01"
          max="1000"
          value={value}
          onChange={(e) => { setValue(e.target.value); setErr(null); }}
          className="w-48 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm tabular-nums focus:border-sorena-gold focus:outline-none focus:ring-1 focus:ring-sorena-gold"
        />
        <p className="mt-1 text-xs text-sorena-text/50">
          Up to {MAX_DECIMALS} decimal places. This is added as a new entry — the
          previous rate stays on record.
        </p>
      </div>
      {liveMessage && <p className="text-xs text-red-600">{liveMessage}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !valid}
          className="rounded-lg bg-sorena-navy px-4 py-2 text-sm font-bold text-white hover:bg-[#162d49] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save rate'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-4 py-2 text-sm font-medium text-sorena-navy hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
