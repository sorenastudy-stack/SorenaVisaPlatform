'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';

// PR-SCORECARD-2 — Agent status toggle + delete (OWNER-only).

type Status = 'ACTIVE' | 'PAUSED' | 'TERMINATED';

export function AgentActions({
  agentId, status, fullName, hasActiveLinks,
}: { agentId: string; status: Status; fullName: string; hasActiveLinks: boolean }) {
  const router = useRouter();
  const { me } = useStaff();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = me?.role === 'OWNER' && !hasActiveLinks;

  async function changeStatus(next: Status) {
    if (next === status) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/staff/marketing/agents/${agentId}/status`, { status: next });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change status.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!canDelete) return;
    if (!confirm(`Delete affiliate agent "${fullName}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/staff/marketing/agents/${agentId}`);
      router.push('/staff/marketing/agents');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete agent.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <StatusButton current={status} target="ACTIVE"     label="Activate"  busy={busy} onClick={changeStatus} />
        <StatusButton current={status} target="PAUSED"     label="Pause"     busy={busy} onClick={changeStatus} />
        <StatusButton current={status} target="TERMINATED" label="Terminate" busy={busy} onClick={changeStatus} />
        {canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-800 border border-red-200 hover:bg-red-100 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
      {error && (
        <div className="text-xs text-red-600 inline-flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </div>
      )}
      {busy && (
        <div className="text-xs text-[#4A4A4A]/60 inline-flex items-center gap-1">
          <Loader2 size={11} className="animate-spin" /> Saving…
        </div>
      )}
    </div>
  );
}

function StatusButton({
  current, target, label, busy, onClick,
}: {
  current: Status; target: Status; label: string;
  busy: boolean; onClick: (t: Status) => void;
}) {
  const active = current === target;
  return (
    <button
      type="button"
      onClick={() => onClick(target)}
      disabled={busy || active}
      className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
        active
          ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] cursor-default'
          : 'bg-white text-[#4A4A4A] border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
      } disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
