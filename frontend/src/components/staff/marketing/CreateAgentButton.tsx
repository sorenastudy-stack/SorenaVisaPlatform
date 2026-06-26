'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// PR-SCORECARD-2 — Create-agent modal trigger button.

interface CreatedAgent {
  id: string;
}

export function CreateAgentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFullName('');
    setEmail('');
    setPhone('');
    setNotes('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.post<CreatedAgent>('/staff/marketing/agents', {
        fullName: fullName.trim(),
        email:    email.trim() || undefined,
        phone:    phone.trim() || undefined,
        notes:    notes.trim() || undefined,
      });
      setOpen(false);
      reset();
      router.refresh();
      router.push(`/staff/marketing/agents/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create agent.');
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
        <Plus size={14} /> Add agent
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#1E3A5F]">Add affiliate agent</h2>
              <button type="button" onClick={() => { setOpen(false); reset(); }} className="text-[#4A4A4A]/60 hover:text-[#4A4A4A]">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-2.5 text-sm rounded-lg bg-red-50 border border-red-200 text-red-800">
                {error}
              </div>
            )}

            <Field label="Full name *" value={fullName} onChange={setFullName} />
            <Field label="Email"        value={email}    onChange={setEmail} type="email" />
            <Field label="Phone"        value={phone}    onChange={setPhone} type="tel" />
            <FieldLong label="Notes"    value={notes}    onChange={setNotes} />

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

function Field({
  label, value, onChange, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-[#1E3A5F]/80 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-[#1E3A5F] focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40"
      />
    </div>
  );
}

function FieldLong({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-[#1E3A5F]/80 mb-1">{label}</label>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-[#1E3A5F] focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40"
      />
    </div>
  );
}
