'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { PendingProfilesTable } from './PendingProfilesTable';
import { VerifyOverlay } from './VerifyOverlay';

// PR-DOCUSIGN-1 step 3 (Screen B) — orchestrator for the verifier
// queue. Owns the fetched-list state, the selected row, and the
// refresh callback used after a successful verify or reject.
//
// Shape comes verbatim from E5
// (LiaProfilesService.listPendingVerification). Dates land as ISO
// strings via JSON.

export interface PendingProfileRow {
  profileId:           string;
  userId:              string;
  userName:            string;
  userEmail:           string;
  iaaLicenceNumber:    string;
  iaaLicenceFileName:  string;
  iaaLicenceFileMime:  string;
  iaaLicenceSizeBytes: number;
  uploadedAt:          string;
  priorRejections:     number;
}

export function LiaVerificationPageClient() {
  const [rows, setRows] = useState<PendingProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PendingProfileRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<PendingProfileRow[]>(
        '/staff/lia-profiles/pending-verification',
      );
      setRows(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to load the verification queue.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sorena-navy">LIA verification</h1>
        <p className="text-sm text-[#4A4A4A]/80 mt-1">
          Review LIA-uploaded IAA licences and approve or reject. Only LIAs you
          mark as verified become eligible for contract assignment.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
          Loading verification queue…
        </div>
      ) : (
        <PendingProfilesTable rows={rows} onRowClick={setSelected} />
      )}

      {selected && (
        <VerifyOverlay
          row={selected}
          onClose={() => setSelected(null)}
          onDone={async () => {
            setSelected(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
