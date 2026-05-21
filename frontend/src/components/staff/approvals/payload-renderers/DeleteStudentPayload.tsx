'use client';

// PR-CONSULT-3 — Payload preview for DELETE_STUDENT.
// Payload: { studentId }
export function DeleteStudentPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <dl className="text-sm space-y-1">
      <div className="flex justify-between gap-3">
        <dt className="text-gray-500">Student ID</dt>
        <dd className="text-gray-900 break-all text-right font-mono text-xs">{String(payload.studentId ?? '—')}</dd>
      </div>
    </dl>
  );
}
