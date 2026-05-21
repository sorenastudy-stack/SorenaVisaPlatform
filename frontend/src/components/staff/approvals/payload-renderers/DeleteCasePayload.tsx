'use client';

// PR-CONSULT-3 — Payload preview for DELETE_CASE.
// Payload: { caseId }
export function DeleteCasePayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <dl className="text-sm space-y-1">
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">Case ID</dt>
        <dd className="text-gray-900 break-all text-right font-mono text-xs">{String(payload.caseId ?? '—')}</dd>
      </div>
    </dl>
  );
}
