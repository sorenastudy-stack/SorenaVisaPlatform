'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, AlertTriangle } from 'lucide-react';

type LeadStatus =
  | 'NEW' | 'CONTACTED' | 'INTAKE_STARTED' | 'INTAKE_COMPLETED' | 'SCORING_DONE'
  | 'QUALIFIED' | 'NURTURE' | 'EXECUTING' | 'CLOSED_WON' | 'CLOSED_LOST'
  | 'DISQUALIFIED';

const ALL_STATUSES: LeadStatus[] = [
  'NEW', 'CONTACTED', 'INTAKE_STARTED', 'INTAKE_COMPLETED', 'SCORING_DONE',
  'QUALIFIED', 'NURTURE', 'EXECUTING', 'CLOSED_WON', 'CLOSED_LOST', 'DISQUALIFIED',
];

function shortLabel(status: LeadStatus): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AdminOverridePanel({
  leadId,
  currentStatus,
}: {
  leadId: string;
  currentStatus: LeadStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [targetStatus, setTargetStatus] = useState<LeadStatus | ''>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!targetStatus) {
      setError('Pick a target status.');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required for an override.');
      return;
    }
    if (targetStatus === currentStatus) {
      setError('Lead is already in that status.');
      return;
    }
    try {
      const res = await fetch(`/api/leads/${leadId}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `Override failed (${res.status})`);
      }
      setSuccess(`Override applied — status changed to ${targetStatus}`);
      setReason('');
      setTargetStatus('');
      setExpanded(false);
      startTransition(() => router.refresh());
    } catch (err: any) {
      setError(err?.message || 'Could not apply override.');
    }
  };

  return (
    <div className="rounded-2xl border-2 border-orange-200 bg-orange-50/50 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-orange-600" />
          <div>
            <h3 className="text-sm font-semibold text-orange-700">
              Admin Override
            </h3>
            <p className="text-xs text-orange-700/70 mt-0.5">
              Super Admin only. Bypasses normal transition rules. All overrides
              are logged with reason.
            </p>
          </div>
        </div>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-white text-orange-700 border border-orange-300 hover:bg-orange-100 min-h-[44px]"
          >
            Override Status
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-[#4A4A4A]/70 block mb-1">
              Target Status
            </label>
            <select
              value={targetStatus}
              onChange={(e) => setTargetStatus(e.target.value as LeadStatus)}
              className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
            >
              <option value="">— Select target status —</option>
              {ALL_STATUSES.filter((s) => s !== currentStatus).map((s) => (
                <option key={s} value={s}>
                  {shortLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider text-[#4A4A4A]/70 block mb-1">
              Reason (required)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Lead was incorrectly disqualified on day 1; reinstating after policy review."
              className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
            />
          </div>

          <div className="flex items-start gap-2 text-xs text-orange-700 bg-orange-100 border border-orange-200 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <p>
              This action skips the standard workflow. The change will be tagged
              "OVERRIDE" in the status history with your name and reason.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSubmit}
              disabled={isPending || !targetStatus || !reason.trim()}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 min-h-[44px]"
            >
              Apply Override
            </button>
            <button
              onClick={() => {
                setExpanded(false);
                setReason('');
                setTargetStatus('');
                setError(null);
              }}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-white text-[#1E3A5F] border border-[#1E3A5F]/20 hover:bg-[#FAF8F3] min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {success}
        </p>
      )}
    </div>
  );
}
