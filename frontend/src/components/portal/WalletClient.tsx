'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Wallet as WalletIcon, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { formatMoneyCents } from '@/lib/money';
import { useLocaleStore } from '@/lib/stores/localeStore';

// PR-WALLET slice 1 — client wallet view (balance + ledger). Read-only.
// Money is Int cents from the API; we divide by 100 for DISPLAY only.
// I18N (Phase 30): copy via t('wallet.*'); amounts stay LATIN via formatMoneyCents
// (locked money convention "NZD 1,200.00"); dates localise via formatDate(locale).

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

export function WalletClient() {
  const t = useTranslations('wallet');
  const locale = useLocaleStore((s) => s.locale);
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
      <Link href="/portal/case" className="mb-4 inline-flex items-center gap-1 text-sm text-sorena-text/60 hover:text-sorena-navy"><ArrowLeft size={14} className="rtl:rotate-180" /> {t('backToCase')}</Link>

      <div className="mb-6 flex items-center gap-2">
        <WalletIcon size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">{t('title')}</h1>
      </div>

      {/* Balance card */}
      <section className="rounded-2xl border border-sorena-navy/10 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-sorena-text/50">{t('availableCredit')}</p>
        {!loaded ? (
          <div className="mt-2 flex items-center gap-2 text-sorena-text/50"><Loader2 size={18} className="animate-spin" /> {t('loading')}</div>
        ) : (
          <p className="mt-1 text-3xl font-bold text-sorena-navy">{formatMoneyCents(data?.balanceCents ?? 0, currency)}</p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-sorena-text/50">
          {t('creditPolicy')}
        </p>
      </section>

      {/* Ledger */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">{t('activity')}</h2>
        {error ? (
          <p className="mt-4 text-sm text-red-600">{t('loadError')}</p>
        ) : !loaded ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-sorena-text/50"><Loader2 size={16} className="animate-spin" /> {t('loading')}</div>
        ) : (data?.transactions.length ?? 0) === 0 ? (
          <p className="mt-4 text-sm text-sorena-text/50">{t('empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {data!.transactions.map((txn) => {
              const positive = txn.amountCents >= 0;
              return (
                <li key={txn.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-sorena-navy">{t.has(`types.${txn.type}`) ? t(`types.${txn.type}`) : txn.type}</p>
                    <p className="text-xs text-sorena-text/50">{formatDate(txn.createdAt, locale)}{txn.reason ? ` · ${txn.reason}` : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-semibold ${positive ? 'text-sorena-jade' : 'text-sorena-navy'}`}>
                      {positive ? '+' : '−'}{formatMoneyCents(Math.abs(txn.amountCents), currency)}
                    </p>
                    <p className="text-[11px] text-sorena-text/40">{t('balancePrefix')} {formatMoneyCents(txn.balanceAfterCents, currency)}</p>
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
