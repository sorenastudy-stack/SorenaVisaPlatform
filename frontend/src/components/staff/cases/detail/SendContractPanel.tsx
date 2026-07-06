'use client';

import { useEffect, useState } from 'react';
import { FileText, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';

// Staff case-detail — "Send contract" action.
//
// On mount, checks whether an engagement contract already exists for the
// case (GET /contracts/:caseId → 404 = none, 200 = exists). If none, offers
// a single "Send contract" button that POSTs /contracts { caseId }; if one
// exists, shows its status instead (no re-send — the backend 400s on a
// duplicate anyway).
//
// Role-gated to the same set the backend POST /contracts enforces
// (OWNER / SUPER_ADMIN / ADMIN / LIA). We gate on StaffContext's `me.role`
// rather than <PermissionGate require=…> because no StaffPermissions flag
// matches this exact set — `canReassign` excludes LIA, who *can* send a
// contract. This is UX-only; the backend guard is the real boundary. On the
// /ops surface (no StaffProvider) `me` is null, so the panel hides itself.

const SEND_CONTRACT_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA'];

type CheckState = 'checking' | 'none' | 'exists' | 'error';

export function SendContractPanel({
  caseId,
  onSent,
}: {
  caseId: string;
  onSent: () => void;
}) {
  const { me } = useStaff();
  const canSend = !!me && SEND_CONTRACT_ROLES.includes(me.role);

  const [state, setState] = useState<CheckState>('checking');
  const [contractStatus, setContractStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!canSend) return;
    let cancelled = false;
    setState('checking');
    setLoadError(null);
    api
      .get<{ status: string }>(`/contracts/${caseId}`)
      .then((c) => {
        if (cancelled) return;
        setContractStatus(c.status);
        setState('exists');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 404) {
          setState('none'); // no contract yet — offer the send button
        } else {
          setLoadError(err instanceof Error ? err.message : 'Failed to check contract');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, canSend]);

  // UX-only role gate — mirrors the backend @Roles on POST /contracts.
  if (!canSend) return null;

  const handleSend = async () => {
    setSending(true);
    try {
      await api.post('/contracts', { caseId });
      toast.success('Contract sent to client');
      onSent();
      // Reflect the new state immediately without a re-fetch.
      setContractStatus('SENT');
      setState('exists');
    } catch (err) {
      // Surfaces the backend precondition messages (case not found /
      // already exists / missing client contact / no LIA available).
      toast.error(err instanceof Error ? err.message : 'Failed to send contract');
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white p-5${
        state === 'none' ? ' border-l-4 border-[#c9a961]' : ''
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <FileText size={16} className="text-[#b8941f]" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          Engagement contract
        </h2>
      </div>

      {state === 'checking' && (
        <p className="text-sm text-gray-500">Checking contract…</p>
      )}

      {state === 'error' && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      )}

      {state === 'exists' && (
        <p className="text-sm text-gray-700">
          Contract: <span className="font-semibold text-[#1e3a5f]">{contractStatus}</span>
        </p>
      )}

      {state === 'none' && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-gray-600">
            No engagement contract has been sent for this case yet.
          </p>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-8 py-3 text-base font-semibold text-[#faf8f3] min-h-[52px] ring-2 ring-[#c9a961]/40 hover:bg-[#16304d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a961] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={18} />
            {sending ? 'Sending…' : 'Send contract'}
          </button>
        </div>
      )}
    </section>
  );
}
