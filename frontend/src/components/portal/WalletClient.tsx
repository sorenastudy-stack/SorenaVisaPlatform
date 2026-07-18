'use client';

import { useEffect, useState } from 'react';
import { Wallet as WalletIcon, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/date';

// PR-WALLET slice 1 — client wallet view (balance + ledger). Read-only.
// Money is Int cents from the API; we divide by 100 for DISPLAY only.

interface Txn {
  id: string;
  amountCents: number;
  type: string;
  balanceAfterCents: number;
  reason: string | null;
  relatedConsultationId: string | null;
  createdAt: string;
}
interface WalletData { balanceCents: number; currency: string; transactions: Txn[]; }

const TYPE_LABEL: Record<string, string> = {
  REFUND_CANCEL_FULL: 'Refund — cancelled early',
  REFUND_CANCEL_LATE: 'Refund — late cancellation',
  REFUND_NO_SHOW: 'Refund — no-show',
  SPEND_BOOKING: 'Used for a booking',
  CASH_REDEMPTION: 'Cash-out',
  ADJUSTMENT: 'Adjustment',
};

function money(cents: number, currency = 'NZD'): string {
  return (cents / 100).toLocaleString('en-NZ', { style: 'currency', currency });
}

export function WalletClient() {
  const [data, setData] = useState<WalletData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<WalletData>('/wallet')
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const currency = data?.currency ?? 'NZD';

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <Link href="/portal/case" className="mb-4 inline-flex items-center gap-1 text-sm text-sorena-text/60 hover:text-sorena-navy"><ArrowLeft size={14} /> My case</Link>

      <div className="mb-1 flex items-center gap-2">
        <WalletIcon size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">My wallet</h1>
      </div>
      <p className="mb-6 text-sm text-[#4A4A4A]/70">Your Sorena credit — top-ups, refunds, and what you&apos;ve spent.</p>

      {/* Balance card */}
      <section className="rounded-2xl border border-sorena-navy/10 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-sorena-text/50">Available credit</p>
        {!loaded ? (
          <div className="mt-2 flex items-center gap-2 text-sorena-text/50"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <p className="mt-1 text-3xl font-bold text-sorena-navy">{money(data?.balanceCents ?? 0, currency)}</p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-sorena-text/50">
          Wallet credit never expires and can be used across Sorena services. It isn’t cash-redeemable (except where legally required) and isn’t transferable.
        </p>
      </section>

      {/* Ledger */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">Activity</h2>
        {error ? (
          <p className="mt-4 text-sm text-red-600">Couldn’t load your wallet. Please refresh.</p>
        ) : !loaded ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-sorena-text/50"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (data?.transactions.length ?? 0) === 0 ? (
          <p className="mt-4 text-sm text-sorena-text/50">No activity yet. Credit from eligible cancellations will appear here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {data!.transactions.map((t) => {
              const positive = t.amountCents >= 0;
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-sorena-navy">{TYPE_LABEL[t.type] ?? t.type}</p>
                    <p className="text-xs text-sorena-text/50">{formatDate(t.createdAt)}{t.reason ? ` · ${t.reason}` : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-semibold ${positive ? 'text-sorena-jade' : 'text-sorena-navy'}`}>
                      {positive ? '+' : '−'}{money(Math.abs(t.amountCents), currency)}
                    </p>
                    <p className="text-[11px] text-sorena-text/40">bal {money(t.balanceAfterCents, currency)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
