'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-SCORECARD-2 — Archive tracking link button.

export function ArchiveLinkButton({ linkId }: { linkId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleArchive() {
    if (!confirm('Archive this tracking link? Existing leads stay attributed; new clicks return 404.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/staff/marketing/links/${linkId}/archive`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to archive link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleArchive}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
        Archive link
      </button>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
