'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-SCORECARD-2 — Create-tracking-link modal trigger.

const CHANNELS = [
  'INSTAGRAM', 'LINKEDIN', 'YOUTUBE', 'TWITTER', 'WHATSAPP', 'EMAIL',
  'WIX_HOMEPAGE', 'TELEGRAM', 'TIKTOK', 'FACEBOOK', 'DIRECT', 'OTHER',
] as const;

interface AgentMini { id: string; fullName: string; }
interface Created { id: string; }

export function CreateLinkButton({ agents }: { agents: AgentMini[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('INSTAGRAM');
  const [agentId, setAgentId] = useState('');
  const [campaignLabel, setCampaignLabel] = useState('');
  const [destination, setDestination] = useState('/scorecard/landing');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setChannel('INSTAGRAM');
    setAgentId('');
    setCampaignLabel('');
    setDestination('/scorecard/landing');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.post<Created>('/staff/marketing/links', {
        channel,
        agentId: agentId || undefined,
        campaignLabel: campaignLabel.trim() || undefined,
        destination: destination.trim() || undefined,
      });
      setOpen(false);
      reset();
      router.refresh();
      router.push(`/staff/marketing/links/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create link.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E3A5F] text-white text-sm font-semibold hover:bg-[#162d49]"
      >
        <Plus size={14} /> Create link
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#1E3A5F]">Create tracking link</h2>
              <button type="button" onClick={() => { setOpen(false); reset(); }} className="text-[#4A4A4A]/60 hover:text-[#4A4A4A]">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-2.5 text-sm rounded-lg bg-red-50 border border-red-200 text-red-800">
                {error}
              </div>
            )}

            <FieldSelect
              label="Channel *"
              value={channel}
              onChange={(v) => setChannel(v as (typeof CHANNELS)[number])}
              options={CHANNELS.map((c) => ({ value: c, label: c }))}
            />
            <FieldSelect
              label="Affiliate agent (optional)"
              value={agentId}
              onChange={setAgentId}
              options={[
                { value: '', label: '— None (pure marketing link) —' },
                ...agents.map((a) => ({ value: a.id, label: a.fullName })),
              ]}
            />
            <FieldText label="Campaign label" value={campaignLabel} onChange={setCampaignLabel} placeholder="e.g. Spring 2026 Promo" />
            <FieldText label="Destination path" value={destination} onChange={setDestination} placeholder="/scorecard/landing" />

            <div className="flex items-center justify-end gap-2 mt-5">
              <button type="button" onClick={() => { setOpen(false); reset(); }} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-[#4A4A4A] hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#F3CE49] text-[#1E3A5F] text-sm font-bold hover:bg-[#d4a91f] disabled:opacity-60"
              >
                {submitting && <Loader2 size={12} className="animate-spin" />}
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function FieldText({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-[#1E3A5F]/80 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-[#1E3A5F] focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40"
      />
    </div>
  );
}

function FieldSelect({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-[#1E3A5F]/80 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-[#1E3A5F] focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
