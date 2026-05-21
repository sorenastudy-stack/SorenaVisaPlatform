'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// PR-CONSULT-4 — Payload preview for HARD_DELETE_STAFF.
//
// Payload shape from StaffUsersController.hardDelete (SUPER_ADMIN
// queued path): { userId }
//
// To give the OWNER more context at decision time, we fire a one-
// shot lookup against /api/staff/users/:id and render the resolved
// name + email + role. If that 403s or 404s (rare — should only
// happen if the user was deleted out-of-band between enqueue and
// approve), we fall back to displaying the userId verbatim.

interface StaffSnapshot {
  id:    string;
  name:  string;
  email: string;
  role:  string;
}

export function HardDeleteStaffPayload({ payload }: { payload: Record<string, unknown> }) {
  const userId = String(payload.userId ?? '');
  const [snapshot, setSnapshot] = useState<StaffSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    api.get<StaffSnapshot>(`/api/staff/users/${userId}`)
      .then(setSnapshot)
      .catch(() => setError('User not found — may have been deleted'));
  }, [userId]);

  if (snapshot) {
    return (
      <dl className="text-sm space-y-1">
        <Row label="Name"  value={snapshot.name || '—'} />
        <Row label="Email" value={snapshot.email} />
        <Row label="Role"  value={snapshot.role} />
        <Row label="User ID" value={snapshot.id} mono />
      </dl>
    );
  }

  return (
    <dl className="text-sm space-y-1">
      <Row label="User ID" value={userId} mono />
      {error && <div className="text-xs text-rose-600 mt-1">{error}</div>}
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
