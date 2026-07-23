'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Send, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';

// Staff "Send contract" action — used in TWO places:
//
//   • Case detail (case-based, legacy): pass `caseId`. On mount it checks
//     whether an engagement contract already exists (GET /contracts/:caseId →
//     404 = none, 200 = exists) and either offers "Send contract" (POST
//     /contracts { caseId }) or shows the existing status.
//
//   • Lead detail (lead-based, PR-CONTRACT-LEAD / Phase B): pass `leadId` +
//     `leadCaseId` (the lead's current caseId, null until the client signs).
//     There is no GET-by-lead endpoint, so the state is derived from
//     `leadCaseId` + a local "sent this session" flag. POST /contracts { leadId }
//     sends lead-based; the case is auto-created when the client signs, at which
//     point `leadCaseId` becomes set and this panel points at the case.
//
// Exactly one of `caseId` / `leadId` is provided. Role-gated (UX-only) to the
// same set the backend POST /contracts enforces (OWNER / SUPER_ADMIN / ADMIN /
// LIA / CLIENT_CONSULTANT); the backend guard is the real boundary. On a surface
// with no StaffProvider `me` is null, so the panel hides itself.

// PR-CONTRACT-LEAD (Phase B) — CLIENT_CONSULTANT (Client Officer) may send too;
// mirrors the widened backend @Roles on POST /contracts.
const SEND_CONTRACT_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CLIENT_CONSULTANT'];

type CheckState = 'checking' | 'none' | 'exists' | 'error';

export function SendContractPanel({
  caseId,
  leadId,
  leadCaseId,
  onSent,
}: {
  caseId?: string;
  leadId?: string;
  leadCaseId?: string | null;
  onSent: () => void;
}) {
  const { me } = useStaff();
  const router = useRouter();
  const canSend = !!me && SEND_CONTRACT_ROLES.includes(me.role);
  const mode: 'case' | 'lead' = caseId ? 'case' : 'lead';

  const [state, setState] = useState<CheckState>(mode === 'case' ? 'checking' : 'none');
  const [contractStatus, setContractStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Lead mode only: the contract was sent during this session (there is no
  // GET-by-lead endpoint to re-derive it after a reload — the backend's
  // duplicate guard covers a re-send attempt with a clear message).
  const [leadSent, setLeadSent] = useState(false);

  useEffect(() => {
    // Case mode does the existence check; lead mode has no GET endpoint.
    if (!canSend || mode !== 'case') return;
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
  }, [caseId, canSend, mode]);

  // UX-only role gate — mirrors the backend @Roles on POST /contracts.
  if (!canSend) return null;

  const handleSend = async () => {
    setSending(true);
    try {
      await api.post('/contracts', mode === 'case' ? { caseId } : { leadId });
      toast.success(
        mode === 'case'
          ? 'Contract sent to client'
          : 'Contract sent — the client signs first, then their case opens automatically',
      );
      onSent();
      if (mode === 'case') {
        // Reflect the new state immediately without a re-fetch.
        setContractStatus('SENT');
        setState('exists');
      } else {
        setLeadSent(true);
      }
    } catch (err) {
      // Surfaces the backend precondition messages VERBATIM — including Phase A
      // gate rejections ("hasn't completed their free 15-minute consultation",
      // "flagged immigration/legal concern … locked until an LIA … approves") and
      // Phase B guards ("a contract has already been sent for this lead").
      toast.error(err instanceof Error ? err.message : 'Failed to send contract');
    } finally {
      setSending(false);
    }
  };

  const header = (
    <div className="flex items-center gap-2 mb-3">
      <FileText size={16} className="text-[#b8941f]" />
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
        Engagement contract
      </h2>
    </div>
  );

  // ─── Lead-based (Phase B) render ──────────────────────────────────────────
  if (mode === 'lead') {
    const caseCreated = !!leadCaseId;
    const highlight = !caseCreated && !leadSent;
    return (
      <section
        className={`rounded-2xl border border-gray-200 bg-white p-5${highlight ? ' border-l-4 border-[#c9a961]' : ''}`}
      >
        {header}

        {caseCreated ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-gray-700">
              A case has opened for this client — the engagement contract is managed there.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/staff/cases/${leadCaseId}`)}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-1 rounded-xl bg-[#1e3a5f] px-6 py-2.5 text-sm font-semibold text-[#faf8f3] hover:bg-[#16304d] transition-colors"
            >
              View case <ArrowRight size={15} />
            </button>
          </div>
        ) : leadSent ? (
          <p className="text-sm text-gray-700">
            Contract sent — waiting for the client to sign. Their case opens automatically once they do.
          </p>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-gray-600">
              No engagement contract has been sent for this lead yet. Sending it now emails the
              client to sign first; their case is created automatically once they do.
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

  // ─── Case-based (legacy) render — unchanged ───────────────────────────────
  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white p-5${
        state === 'none' ? ' border-l-4 border-[#c9a961]' : ''
      }`}
    >
      {header}

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
