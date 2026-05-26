'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, X, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-LIA-9 — OWNER-only "Run reminder sweep now" button.
//
// Manual trigger of POST /staff/visa-expiry/run-sweep-now. Guarded
// by a confirmation overlay because this fires real emails. The
// backend route is role-gated to OWNER/ADMIN/SUPER_ADMIN, so even if
// this component leaked into an LIA viewer the underlying request
// would 403.

interface SweepResult {
  dispatched: number;
  skipped: number;
  failed: number;
}

export function RunReminderSweepButton({ candidateCount }: { candidateCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<SweepResult>('/staff/visa-expiry/run-sweep-now', {});
      setResult(r);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to trigger sweep.');
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    if (submitting) return;
    setOpen(false);
    setResult(null);
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#E8B923]/40 bg-[#E8B923]/10 text-[#1E3A5F] text-xs font-semibold px-3 py-2 hover:border-[#E8B923] transition-colors"
      >
        <Zap size={12} />
        Run reminders now
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-full bg-[#E8B923]/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-[#1E3A5F]" />
                </div>
                <h2 className="text-lg font-bold text-[#1E3A5F]">Run reminder sweep</h2>
              </div>
              <button type="button" onClick={close} disabled={submitting} className="text-gray-400 hover:text-gray-700 disabled:opacity-50 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            {result === null && (
              <>
                <p className="text-sm text-[#4A4A4A] bg-[#FAF8F3] border border-gray-200 rounded-lg px-3 py-2 mb-4 leading-relaxed">
                  This will fire reminder emails for any visa in the 30 / 14 / 7-day expiry windows that hasn't already received one. Up to <strong>3 × {candidateCount}</strong> emails could be dispatched (LIA + client + every OWNER per visa).
                </p>
                <p className="text-xs text-[#4A4A4A]/70 mb-4">
                  De-duplication ensures previously-sent reminders are NOT re-sent — the unique <code className="font-mono">(visaId, threshold, recipient)</code> constraint protects against repeat blasts.
                </p>

                {error && (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={close} disabled={submitting} className="min-h-[44px] px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-[#4A4A4A] hover:bg-gray-50">
                    Cancel
                  </button>
                  <button type="button" onClick={handleSubmit} disabled={submitting} className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-bold hover:bg-[#E8B923] hover:text-[#1E3A5F] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">
                    {submitting ? 'Running…' : 'Run sweep'}
                  </button>
                </div>
              </>
            )}

            {result !== null && (
              <>
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-4 text-sm text-emerald-900">
                  Sweep complete. Results:
                </div>
                <dl className="grid grid-cols-3 gap-3 mb-4 text-center">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                    <dd className="text-2xl font-bold text-emerald-800">{result.dispatched}</dd>
                    <dt className="text-xs text-emerald-700 mt-1">Dispatched</dt>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <dd className="text-2xl font-bold text-gray-700">{result.skipped}</dd>
                    <dt className="text-xs text-gray-600 mt-1">Skipped (dup)</dt>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <dd className="text-2xl font-bold text-red-700">{result.failed}</dd>
                    <dt className="text-xs text-red-700 mt-1">Failed</dt>
                  </div>
                </dl>
                <div className="flex items-center justify-end">
                  <button type="button" onClick={close} className="min-h-[44px] px-4 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#E8B923] hover:text-[#1E3A5F]">
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
