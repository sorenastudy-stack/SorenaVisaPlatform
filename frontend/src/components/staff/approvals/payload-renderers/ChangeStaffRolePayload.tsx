'use client';

// PR-CONSULT-3 — Payload preview for CHANGE_STAFF_ROLE.
//
// Payload shape from StaffUsersController.changeRole:
//   { userId, newRole }
//
// We deliberately don't fetch the target user's name here — the
// OWNER can see the full user via the Staff Users page if they need
// extra context. Showing the ID + new role is enough to recognise
// what's being approved without firing an extra request per row.

export function ChangeStaffRolePayload({ payload }: { payload: Record<string, unknown> }) {
  const userId  = String(payload.userId ?? '—');
  const newRole = String(payload.newRole ?? '—');
  return (
    <dl className="text-sm space-y-1">
      <Row label="User ID"  value={userId} />
      <Row label="New role" value={newRole} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 break-all text-right font-mono text-xs">{value}</dd>
    </div>
  );
}
