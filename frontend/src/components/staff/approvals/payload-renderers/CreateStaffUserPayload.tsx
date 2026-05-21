'use client';

// PR-CONSULT-3 — Payload preview for CREATE_STAFF_USER.
//
// Payload shape (from StaffUsersController.create):
//   { email, fullName, role }

export function CreateStaffUserPayload({ payload }: { payload: Record<string, unknown> }) {
  const email    = String(payload.email ?? '—');
  const fullName = String(payload.fullName ?? payload.name ?? '—');
  const role     = String(payload.role ?? '—');
  return (
    <dl className="text-sm space-y-1">
      <Row label="Name"  value={fullName} />
      <Row label="Email" value={email} />
      <Row label="Role"  value={role} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 break-all text-right">{value}</dd>
    </div>
  );
}
