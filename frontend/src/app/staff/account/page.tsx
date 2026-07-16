'use client';

import { useState } from 'react';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// Phase F — signed-in staff change their OWN password. Requires the CURRENT
// password (verified server-side with bcrypt) before setting a new one — a
// hijacked session can't lock the owner out. userId comes from the JWT on the
// backend; nothing identifying is sent from the client. English-only.

export default function StaffAccountPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const longEnough = next.length >= 10;
  const hasLetter = /[A-Za-z]/.test(next);
  const hasNumber = /[0-9]/.test(next);
  const strong = longEnough && hasLetter && hasNumber;
  const matches = next.length > 0 && next === confirm;
  const canSubmit = current.length > 0 && strong && matches && !submitting;

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change your password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold text-[#1e3a5f] mb-1">Account</h1>
      <p className="text-sm text-[#4A4A4A]/70 mb-8">Change your password.</p>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#1e3a5f]">
          <KeyRound size={18} className="text-[#c9a961]" /> Change password
        </div>

        {done && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span>Your password has been changed. Use it next time you sign in.</span>
          </div>
        )}

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" placeholder="Your current password" />
          <Field label="New password" value={next} onChange={setNext} autoComplete="new-password" placeholder="At least 10 characters" />
          <Field label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Re-enter your new password" />

          <ul className="text-xs text-[#4A4A4A]/70 space-y-1">
            <li className={longEnough ? 'text-emerald-600' : ''}>• At least 10 characters</li>
            <li className={hasLetter ? 'text-emerald-600' : ''}>• At least one letter</li>
            <li className={hasNumber ? 'text-emerald-600' : ''}>• At least one number</li>
            <li className={matches ? 'text-emerald-600' : ''}>• Both new passwords match</li>
          </ul>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[#1e3a5f] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[#162d4a] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, autoComplete, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; placeholder: string }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#1e3a5f] mb-1.5">{label}</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-[#1e3a5f] focus:border-[#c9a961] focus:outline-none focus:ring-2 focus:ring-[#c9a961]/30"
      />
    </div>
  );
}
