'use client';

import { useRef, useState } from 'react';
import { KeyRound, CheckCircle2, Camera, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useStaff } from '@/contexts/StaffContext';
import { StaffAvatar } from '@/components/staff/StaffAvatar';

// Phase F — signed-in staff change their OWN password + (PR-STAFF-PHOTOS) their
// OWN profile photo. Both are own-JWT-only: the backend takes the userId from
// the token, nothing identifying is sent from the client. English-only.

const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX = 5 * 1024 * 1024;

export default function StaffAccountPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // ── Profile photo (own) ───────────────────────────────────────────────
  const { me, refresh } = useStaff();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  const [photoMsg, setPhotoMsg] = useState('');

  const onPick = (f: File | null) => {
    setPhotoErr(''); setPhotoMsg('');
    if (!f) { setPicked(null); setPreview(null); return; }
    if (!PHOTO_MIMES.includes(f.type)) { setPhotoErr('Please choose a JPG, PNG, or WebP image.'); return; }
    if (f.size > PHOTO_MAX) { setPhotoErr('Image must be under 5 MB.'); return; }
    setPicked(f); setPreview(URL.createObjectURL(f));
  };

  const onUploadPhoto = async () => {
    if (!picked) return;
    setPhotoBusy(true); setPhotoErr(''); setPhotoMsg('');
    try {
      const fd = new FormData();
      fd.append('file', picked);
      await api.upload('/api/staff/me/photo', fd);
      setPicked(null); setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      setPhotoMsg('Photo updated.');
      await refresh(); // top-right + lists pick up the new photo
    } catch (e) {
      setPhotoErr(e instanceof ApiError ? e.message : 'Could not upload your photo.');
    } finally { setPhotoBusy(false); }
  };

  const onRemovePhoto = async () => {
    setPhotoBusy(true); setPhotoErr(''); setPhotoMsg('');
    try {
      await api.delete('/api/staff/me/photo');
      setPicked(null); setPreview(null);
      setPhotoMsg('Photo removed.');
      await refresh();
    } catch (e) {
      setPhotoErr(e instanceof ApiError ? e.message : 'Could not remove your photo.');
    } finally { setPhotoBusy(false); }
  };

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
      <p className="text-sm text-[#4A4A4A]/70 mb-8">Your profile photo and password.</p>

      {/* Profile photo (own) */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm mb-6">
        <div className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#1e3a5f]">
          <Camera size={18} className="text-[#c9a961]" /> Profile photo
        </div>
        <div className="flex items-center gap-5">
          <StaffAvatar name={me?.fullName ?? ''} photoUrl={preview ?? me?.photoUrl} size={80} />
          <div className="min-w-0 flex-1">
            <input
              ref={fileRef}
              id="photo-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <div className="flex flex-wrap gap-2">
              <label
                htmlFor="photo-input"
                className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-[#1e3a5f]/20 px-4 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#faf8f3]"
              >
                Choose image
              </label>
              {picked && (
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={onUploadPhoto}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#1e3a5f] px-5 text-sm font-bold text-white transition-colors hover:bg-[#162d4a] disabled:opacity-50"
                >
                  {photoBusy ? 'Uploading…' : 'Upload'}
                </button>
              )}
              {me?.photoUrl && !picked && (
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={onRemovePhoto}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={15} /> Remove
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-[#4A4A4A]/60">
              JPG, PNG, or WebP. Max 5&nbsp;MB.{picked ? ` · ${picked.name}` : ''}
            </p>
            {photoErr && <p className="mt-1 text-xs text-red-600">{photoErr}</p>}
            {photoMsg && <p className="mt-1 text-xs text-emerald-600">{photoMsg}</p>}
          </div>
        </div>
      </div>

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
