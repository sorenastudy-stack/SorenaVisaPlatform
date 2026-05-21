'use client';

import { useState } from 'react';
import { StaffUsersPageHeader } from './StaffUsersPageHeader';
import { StaffUsersTable } from './StaffUsersTable';
import { CreateStaffOverlay } from './CreateStaffOverlay';
import { StaffDetailOverlay } from './StaffDetailOverlay';
import { useStaffUsersQuery } from './useStaffUsersQuery';
import type { StaffUserRow } from './types';
import type { StaffRole } from '@/contexts/StaffContext';

// PR-CONSULT-3 — Staff Users page client component.
// PR-CONSULT-4 — `Active only` toggle replaced by `Show archived`
// (matching the new server-side ?archived=… filter). Archived rows
// render visually muted in the table.

export function StaffUsersPageClient() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<StaffRole | ''>('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<StaffUserRow | null>(null);

  const { rows, loading, error, refresh } = useStaffUsersQuery({
    q:        search,
    role,
    archived: showArchived ? 'all' : 'false',
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <StaffUsersPageHeader
        search={search}
        onSearchChange={setSearch}
        role={role}
        onRoleChange={setRole}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
        onCreate={() => setCreating(true)}
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
          Loading staff…
        </div>
      ) : (
        <StaffUsersTable rows={rows} onRowClick={setSelected} />
      )}

      {creating && (
        <CreateStaffOverlay
          onClose={() => setCreating(false)}
          onDone={refresh}
        />
      )}

      {selected && (
        <StaffDetailOverlay
          user={selected}
          open={!!selected}
          onClose={() => setSelected(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
