'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-AGENT-PORTAL-2 — the agent's commission rate, and the ability to set it.
//
// Until now the column existed, the payables deriver read it, and there was no
// way to write it: every agent silently earned the company default.
//
// BLANK IS NOT ZERO. Clearing the field sends null, which means "no per-agent
// rate — use the company default". Zero means "we agreed nothing". The input
// keeps them distinct and the helper text says so, because the two are a
// payment apart.
//
// The Owner-only rule is enforced on the server (the service re-checks the role,
// not just the route decorator). Hiding the control here is presentation.

export function AgentRateCard({
  agentId, ratePercent, effectiveRatePercent, usesCompanyDefault, canEdit,
}: {
  agentId: string;
  ratePercent: number | null;
  effectiveRatePercent: number;
  usesCompanyDefault: boolean;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(ratePercent === null ? '' : String(ratePercent));
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState({ ratePercent, effectiveRatePercent, usesCompanyDefault });

  const save = async () => {
    const trimmed = value.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100)) {
      toast.error('Enter a rate between 0 and 100, or leave it blank to use the company default.');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.patch<{ commissionRatePercent: number | null; effectiveRatePercent: number; usesCompanyDefault: boolean }>(
        `/staff/marketing/agents/${agentId}/rate`, { ratePercent: next },
      );
      setCurrent({
        ratePercent: updated.commissionRatePercent,
        effectiveRatePercent: updated.effectiveRatePercent,
        usesCompanyDefault: updated.usesCompanyDefault,
      });
      toast.success(next === null ? 'Rate cleared — the company default now applies.' : `Rate set to ${next}%.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save the rate.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardContent>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#4A4A4A]/60">Commission rate</h2>

        <p className="mb-4 text-2xl font-extrabold text-[#1E3A5F]">
          {current.effectiveRatePercent}%
          {current.usesCompanyDefault && (
            <span className="ml-2 align-middle text-xs font-semibold text-[#4A4A4A]/50">company default</span>
          )}
        </p>

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#4A4A4A]/70">Rate for this agent (%)</label>
              <input
                type="number" min={0} max={100} step="0.01" value={value} disabled={saving}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Leave blank for the default"
                className="w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={save} disabled={saving}
              className="min-h-[40px] rounded-lg bg-[#1E3A5F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save rate'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-[#4A4A4A]/60">Only the Owner can change an agent&rsquo;s rate.</p>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-[#4A4A4A]/60">
          Leave blank to use the company default. That is not the same as 0% — blank means no rate
          was agreed for this agent, 0% means one was and it is nothing. Changing this does not
          restate anything already owed: each payable keeps the rate it was calculated with.
        </p>
      </CardContent>
    </Card>
  );
}
