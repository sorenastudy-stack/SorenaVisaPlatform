'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

// PR-CARD-REFUND — payload preview for ISSUE_REFUND (real money out).
//
// New payload shape: { consultationId, reason }. The card resolves the real
// booking from the consultationId via GET /staff/consultations/:id/refund-preview
// so the owner sees WHO is being refunded, WHICH booking, and the FULL captured
// amount (from the consultation's Payment) before approving — not the stale
// paymentId/amountCents fields the old renderer read. Display only; the
// authoritative amount + guards are re-derived at execution.

interface Preview {
  clientName: string;
  type: string;
  scheduledAt: string | null;
  timezone: string | null;
  currency: string;
  capturedAmountNZD: number | null;
  blocked: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  FREE_15: 'Free 15-min', GAP_CLOSING: 'Gap-Closing', LIA: 'LIA Consultation', ADMISSION: 'Admission',
};

function fmtDate(iso: string | null, tz: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: tz ?? 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function IssueRefundPayload({ payload }: { payload: Record<string, unknown> }) {
  const consultationId = String(payload.consultationId ?? '');
  const reason = payload.reason ? String(payload.reason) : null;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!consultationId) { setError(true); return; }
    let live = true;
    api.get<Preview>(`/staff/consultations/${consultationId}/refund-preview`)
      .then((p) => { if (live) setPreview(p); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [consultationId]);

  if (!consultationId) {
    return <p className="text-sm text-red-600">Malformed refund request — no booking reference.</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600">Couldn’t load the refund details. Refresh before approving.</p>;
  }
  if (!preview) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> Loading refund details…
      </div>
    );
  }

  const amount = preview.capturedAmountNZD != null
    ? `${preview.currency ?? 'NZD'} ${preview.capturedAmountNZD.toFixed(2)}`
    : '—';

  return (
    <dl className="text-sm space-y-1">
      <Row label="Client" value={preview.clientName} />
      <Row label="Booking" value={`${TYPE_LABEL[preview.type] ?? preview.type} · ${fmtDate(preview.scheduledAt, preview.timezone)}`} />
      <div className="flex justify-between gap-3 pt-1">
        <dt className="text-gray-500 font-medium">Refund to card</dt>
        <dd className="text-gray-900 font-bold text-right">{amount}</dd>
      </div>
      {reason && <Row label="Reason" value={reason} />}
      {preview.blocked && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>No longer refundable: {preview.blocked} Approving will fail — no money will move.</span>
        </div>
      )}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 break-words text-right">{value}</dd>
    </div>
  );
}
