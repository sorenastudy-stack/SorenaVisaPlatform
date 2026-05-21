'use client';

// PR-CONSULT-3 — Payload preview for DEACTIVATE_STAFF.
// Payload: { userId }
export function DeactivateStaffPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <dl className="text-sm space-y-1">
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">User ID</dt>
        <dd className="text-gray-900 break-all text-right font-mono text-xs">{String(payload.userId ?? '—')}</dd>
      </div>
    </dl>
  );
}
