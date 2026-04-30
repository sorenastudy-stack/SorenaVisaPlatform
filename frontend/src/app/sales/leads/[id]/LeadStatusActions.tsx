'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, AlertTriangle, ArrowRight, Clock, User, Undo2 } from 'lucide-react';
import { LEAD_STATUS_GLOSSARY, LEAD_STATUS_GUIDES } from '@/lib/glossary';
import { InfoTip } from '@/components/ui/InfoTip';

type LeadStatus =
  | 'NEW' | 'CONTACTED' | 'INTAKE_STARTED' | 'INTAKE_COMPLETED' | 'SCORING_DONE'
  | 'QUALIFIED' | 'NURTURE' | 'EXECUTING' | 'CLOSED_WON' | 'CLOSED_LOST'
  | 'DISQUALIFIED';

const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW:              ['CONTACTED'],
  CONTACTED:        ['INTAKE_STARTED'],
  INTAKE_STARTED:   ['INTAKE_COMPLETED'],
  INTAKE_COMPLETED: ['SCORING_DONE'],
  SCORING_DONE:     ['QUALIFIED', 'NURTURE', 'DISQUALIFIED'],
  QUALIFIED:        ['EXECUTING', 'CLOSED_WON', 'CLOSED_LOST'],
  NURTURE:          ['CONTACTED', 'QUALIFIED', 'DISQUALIFIED'],
  EXECUTING:        ['CLOSED_WON', 'CLOSED_LOST'],
  CLOSED_WON:       [],
  CLOSED_LOST:      [],
  DISQUALIFIED:     [],
};

const ALL_ACTIONS: Record<LeadStatus, { label: string; tone: 'primary' | 'neutral' | 'danger' }> = {
  NEW:              { label: 'Mark New',              tone: 'neutral' },
  CONTACTED:        { label: 'Mark Contacted',        tone: 'primary' },
  INTAKE_STARTED:   { label: 'Start Intake',          tone: 'primary' },
  INTAKE_COMPLETED: { label: 'Mark Intake Complete',  tone: 'primary' },
  SCORING_DONE:     { label: 'Mark Scoring Done',     tone: 'primary' },
  QUALIFIED:        { label: 'Qualify',               tone: 'primary' },
  NURTURE:          { label: 'Move to Nurture',       tone: 'neutral' },
  EXECUTING:        { label: 'Move to Executing',     tone: 'primary' },
  CLOSED_WON:       { label: 'Close as Won',          tone: 'primary' },
  CLOSED_LOST:      { label: 'Close as Lost',         tone: 'danger'  },
  DISQUALIFIED:     { label: 'Disqualify',            tone: 'danger'  },
};

const buttonToneClasses: Record<string, string> = {
  primary: 'bg-[#E8B923] text-[#1E3A5F] hover:bg-[#d4a51e] disabled:bg-[#E8B923]/50',
  neutral: 'bg-white text-[#1E3A5F] border border-[#1E3A5F]/20 hover:bg-[#FAF8F3] disabled:opacity-50',
  danger:  'bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-50',
};

const stripToneClasses: Record<string, string> = {
  primary: 'bg-[#E8B923]/10 text-[#1E3A5F] border-[#E8B923]/40',
  neutral: 'bg-purple-50 text-purple-700 border-purple-200',
  danger:  'bg-red-50 text-red-700 border-red-200',
};

function shortLabel(status: LeadStatus): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDecisionContext(currentStatus: LeadStatus): {
  decisionPointLabel: string;
  outcomes: LeadStatus[];
} | null {
  if (
    currentStatus === 'SCORING_DONE' ||
    currentStatus === 'QUALIFIED' ||
    currentStatus === 'NURTURE' ||
    currentStatus === 'DISQUALIFIED'
  ) {
    return {
      decisionPointLabel: 'Scoring Decision',
      outcomes: ['QUALIFIED', 'NURTURE', 'DISQUALIFIED'],
    };
  }
  if (
    currentStatus === 'EXECUTING' ||
    currentStatus === 'CLOSED_WON' ||
    currentStatus === 'CLOSED_LOST'
  ) {
    return {
      decisionPointLabel: 'Execution Outcome',
      outcomes: ['EXECUTING', 'CLOSED_WON', 'CLOSED_LOST'],
    };
  }
  return null;
}

export function LeadStatusActions({
  leadId,
  currentStatus,
}: {
  leadId: string;
  currentStatus: LeadStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingDisqualify, setPendingDisqualify] = useState(false);
  const [disqualifyReason, setDisqualifyReason] = useState('');
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    if (!undoVisible || undoSecondsLeft <= 0) return;
    const t = setTimeout(() => {
      setUndoSecondsLeft((s) => {
        const next = s - 1;
        if (next <= 0) setUndoVisible(false);
        return next;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [undoVisible, undoSecondsLeft]);

  const allowedNext = VALID_TRANSITIONS[currentStatus];
  const decision = getDecisionContext(currentStatus);
  const guide = LEAD_STATUS_GUIDES[currentStatus];

  const sendUpdate = async (newStatus: LeadStatus, reason?: string) => {
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, unknown> = { status: newStatus };
      if (reason) body.disqualificationReason = reason;
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `Request failed (${res.status})`);
      }
      setSuccess(`Status updated to ${newStatus}`);
      setPendingDisqualify(false);
      setDisqualifyReason('');
      setUndoError(null);
      setUndoVisible(true);
      setUndoSecondsLeft(60);
      startTransition(() => router.refresh());
    } catch (err: any) {
      setError(err?.message || 'Could not update lead status.');
    }
  };

  const handleUndo = async () => {
    setUndoError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/undo`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `Undo failed (${res.status})`);
      }
      setSuccess('Reverted');
      setUndoVisible(false);
      setUndoSecondsLeft(0);
      startTransition(() => router.refresh());
    } catch (err: any) {
      setUndoError(err?.message || 'Could not undo.');
    }
  };

  const handleClick = (newStatus: LeadStatus) => {
    if (newStatus === 'DISQUALIFIED') {
      setPendingDisqualify(true);
      return;
    }
    sendUpdate(newStatus);
  };

  return (
    <div className="space-y-6">
      {/* Decision Strip */}
      {decision && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[#4A4A4A]/60 mb-2">
            {decision.decisionPointLabel}
          </p>
          <div className="flex flex-wrap gap-2">
            {decision.outcomes.map((outcome) => {
              const isActive = currentStatus === outcome;
              const action = ALL_ACTIONS[outcome];
              const entry = LEAD_STATUS_GLOSSARY[outcome];
              return (
                <span
                  key={outcome}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    isActive
                      ? 'bg-[#E8B923] text-[#1E3A5F] border-[#E8B923] shadow-sm'
                      : stripToneClasses[action.tone] + ' opacity-60'
                  }`}
                >
                  {isActive && <Check size={12} strokeWidth={3} />}
                  {shortLabel(outcome)}
                  {entry && <InfoTip entry={entry} iconSize={12} />}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Next Step Guide card */}
      {guide && (
        <div className="rounded-2xl border border-[#E8B923]/30 bg-[#E8B923]/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowRight size={16} className="text-[#E8B923]" />
            <h4 className="text-sm font-semibold text-[#1E3A5F]">
              Next Step Guide — {shortLabel(currentStatus)}
            </h4>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[#4A4A4A]/60 mb-1">
                What just happened
              </p>
              <p className="text-[#4A4A4A]">{guide.justHappened}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[#4A4A4A]/60 mb-1">
                What to do next
              </p>
              <p className="text-[#4A4A4A]">{guide.nextStep}</p>
            </div>
            <div className="flex items-start gap-2">
              <Clock size={14} className="text-[#E8B923] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#4A4A4A]/60 mb-0.5">
                  SLA
                </p>
                <p className="text-[#4A4A4A]">{guide.sla}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <User size={14} className="text-[#E8B923] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#4A4A4A]/60 mb-0.5">
                  Client experience
                </p>
                <p className="text-[#4A4A4A]">{guide.clientExperience}</p>
              </div>
            </div>
          </div>
          {guide.warning && (
            <div className="mt-3 pt-3 border-t border-[#E8B923]/30 flex items-start gap-2">
              <AlertTriangle size={14} className="text-orange-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-orange-700">{guide.warning}</p>
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      {allowedNext.length === 0 ? (
        <p className="text-sm text-[#4A4A4A]/60">
          No further actions available — this lead is in a terminal state.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {allowedNext.map((nextStatus) => {
            const action = ALL_ACTIONS[nextStatus];
            return (
              <div key={nextStatus} className="inline-flex items-center gap-1.5">
                <button
                  onClick={() => handleClick(nextStatus)}
                  disabled={isPending}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors min-h-[48px] ${
                    buttonToneClasses[action.tone]
                  }`}
                >
                  {action.label}
                </button>
                {LEAD_STATUS_GLOSSARY[nextStatus] && (
                  <InfoTip entry={LEAD_STATUS_GLOSSARY[nextStatus]} iconSize={16} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Disqualify reason form */}
      {pendingDisqualify && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-medium text-red-700">
            Reason for disqualification (required)
          </p>
          <textarea
            value={disqualifyReason}
            onChange={(e) => setDisqualifyReason(e.target.value)}
            rows={3}
            placeholder="e.g. Cannot meet financial requirements; visa pre-conditions failed; etc."
            className="w-full px-3 py-2 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 bg-white"
          />
          <div className="flex gap-2">
            <button
              onClick={() => sendUpdate('DISQUALIFIED', disqualifyReason.trim())}
              disabled={!disqualifyReason.trim() || isPending}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 min-h-[44px]"
            >
              Confirm Disqualify
            </button>
            <button
              onClick={() => {
                setPendingDisqualify(false);
                setDisqualifyReason('');
              }}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-white text-[#1E3A5F] border border-[#1E3A5F]/20 hover:bg-[#FAF8F3] min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Status messages */}
      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <span>{success}</span>
          {undoVisible && (
            <button
              type="button"
              onClick={handleUndo}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-[#1E3A5F] border border-[#1E3A5F]/20 hover:bg-[#FAF8F3] text-xs font-semibold transition-colors"
            >
              <Undo2 size={12} />
              Undo ({undoSecondsLeft}s)
            </button>
          )}
        </div>
      )}

      {undoError && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {undoError}
        </p>
      )}
    </div>
  );
}
