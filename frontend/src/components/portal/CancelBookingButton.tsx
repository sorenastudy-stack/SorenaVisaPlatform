'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatMoneyCents } from '@/lib/money';

// PR-WALLET slice 2 — client "Cancel booking" with an authoritative tier
// preview (fetched from the server) before confirming. On success the wallet
// credit + status flip have already happened server-side; we refresh so the
// upcoming-sessions list and wallet reflect it.

interface Preview {
  eligible: boolean;
  free?: boolean;
  tier?: string;
  creditCents?: number;
  retainedCents?: number;
  currency?: string;
  reason?: string;
  note?: string;
}

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const t = useTranslations('cancelBooking');
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true); setPreview(null); setError(null); setLoading(true);
    try {
      setPreview(await api.get<Preview>(`/booking/${bookingId}/cancel-preview`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('loadError'));
    } finally { setLoading(false); }
  }

  async function confirm() {
    setSubmitting(true); setError(null);
    try {
      await api.post(`/booking/${bookingId}/cancel`, {});
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('cancelError'));
    } finally { setSubmitting(false); }
  }

  const currency = preview?.currency ?? 'NZD';

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:border-red-300 hover:text-red-600"
      >
        {t('button')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && setOpen(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-[#1e3a5f]">{t('confirmTitle')}</h2>
              <button type="button" onClick={() => !submitting && setOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> {t('checking')}</div>
            ) : error ? (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">{error}</p>
            ) : preview && !preview.eligible ? (
              <p className="text-sm text-gray-600">{preview.reason ?? t('notCancellable')}</p>
            ) : preview?.free ? (
              <p className="text-sm text-gray-600">{t('freeSession')}</p>
            ) : preview ? (
              <div className="text-sm text-gray-700">
                <p>{t.rich('creditAdded', { amount: formatMoneyCents(preview.creditCents ?? 0, currency), strong: (c) => <strong>{c}</strong> })}</p>
                {(preview.retainedCents ?? 0) > 0 && (
                  <p className="mt-1 text-gray-500">{t('retained', { amount: formatMoneyCents(preview.retainedCents ?? 0, currency), tier: preview.tier === 'REFUND_CANCEL_LATE' ? t('tierLate') : t('tierPolicy') })}</p>
                )}
                {preview.note && <p className="mt-2 text-xs text-amber-700">{t('note', { note: preview.note })}</p>}
                <p className="mt-3 text-xs text-gray-500">{t('creditNote')}</p>
              </div>
            ) : null}

            {preview?.eligible && !loading && (
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={confirm} disabled={submitting} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  {submitting ? t('cancelling') : t('yesCancel')}
                </button>
                <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  {t('keepIt')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
