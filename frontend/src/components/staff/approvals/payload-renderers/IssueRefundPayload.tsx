'use client';

// PR-CONSULT-3 — Payload preview for ISSUE_REFUND.
//
// Payload shape from PR-CONSULT-1's execIssueRefund:
//   { paymentId, amountCents | amount, reason? }
//
// We display the cents value formatted as a number — the Stripe
// integration that consumes this PR's queue can format currency
// once it's wired (currency code lives on the Payment row).
export function IssueRefundPayload({ payload }: { payload: Record<string, unknown> }) {
  const paymentId   = String(payload.paymentId ?? '—');
  const amountCents = Number(payload.amountCents ?? payload.amount ?? 0);
  const reason      = payload.reason ? String(payload.reason) : null;
  return (
    <dl className="text-sm space-y-1">
      <Row label="Payment ID" value={paymentId} mono />
      <Row label="Amount (¢)" value={Number.isFinite(amountCents) ? String(amountCents) : '—'} />
      {reason !== null && <Row label="Reason" value={reason} />}
    </dl>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`text-gray-900 break-all text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
