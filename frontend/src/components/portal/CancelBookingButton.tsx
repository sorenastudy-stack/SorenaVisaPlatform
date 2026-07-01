'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

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

function money(cents: number, currency = 'NZD'): string {
  return (cents / 100).toLocaleString('en-NZ', { style: 'currency', currency });
}

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
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
      setError(e instanceof ApiError ? e.message : 'Could not load cancellation details.');
    } finally { setLoading(false); }
  }

  async function confirm() {
    setSubmitting(true); setError(null);
    try {
      await api.post(`/booking/${bookingId}/cancel`, {});
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel the booking.');
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
        Cancel booking
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && setOpen(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-[#1e3a5f]">Cancel this booking?</h2>
              <button type="button" onClick={() => !submitting && setOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Checking…</div>
            ) : error ? (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">{error}</p>
            ) : preview && !preview.eligible ? (
              <p className="text-sm text-gray-600">{preview.reason ?? 'This booking can’t be cancelled here.'}</p>
            ) : preview?.free ? (
              <p className="text-sm text-gray-600">This is a free session — cancelling it makes no charge and no wallet change.</p>
            ) : preview ? (
              <div className="text-sm text-gray-700">
                <p><strong>{money(preview.creditCents ?? 0, currency)}</strong> will be added to your Sorena wallet.</p>
                {(preview.retainedCents ?? 0) > 0 && (
                  <p className="mt-1 text-gray-500">{money(preview.retainedCents ?? 0, currency)} is retained as an admin fee ({preview.tier === 'REFUND_CANCEL_LATE' ? 'within 24 hours' : 'per policy'}).</p>
                )}
                {preview.note && <p className="mt-2 text-xs text-amber-700">Note: {preview.note}.</p>}
                <p className="mt-3 text-xs text-gray-500">Wallet credit never expires and can be used on future Sorena services.</p>
              </div>
            ) : null}

            {preview?.eligible && !loading && (
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={confirm} disabled={submitting} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  {submitting ? 'Cancelling…' : 'Yes, cancel'}
                </button>
                <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Keep it
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
