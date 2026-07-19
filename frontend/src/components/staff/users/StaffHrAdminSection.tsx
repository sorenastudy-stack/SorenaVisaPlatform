'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, Eye, Trash2, Loader2, Camera } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { StaffAvatar } from '@/components/staff/StaffAvatar';

const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX = 5 * 1024 * 1024;

// PR-STAFF-HR (Phase 3) — admin HR controls inside the staff detail overlay.
// ADMIN/OWNER only (rendered under the overlay's canManageStaff gate + the
// backend @AdminTier guard). Manages ONE staff member's contract PDF +
// job-description text. Staff read their own via /staff/me/* separately.

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';
const MAX_BYTES = 10 * 1024 * 1024;

interface ContractMeta {
  hasContract: boolean;
  originalName?: string;
  sizeBytes?: number;
  uploadedAt?: string;
}

function fmtBytes(n?: number): string {
  if (!n) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function StaffHrAdminSection({
  userId,
  userName,
  photoUrl,
  onPhotoChanged,
}: {
  userId: string;
  userName: string;
  photoUrl?: string | null;
  onPhotoChanged?: () => void;
}) {
  const [contract, setContract] = useState<ContractMeta | null>(null);
  const [jd, setJd] = useState('');
  const [jdSetAt, setJdSetAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Profile photo (admin — audited server-side) ─────────────────────────
  const [photo, setPhoto] = useState<string | null>(photoUrl ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  // Auto-upload on selection (same fix as the Account page): a preview shown
  // before a separate "Upload" click was being mistaken for a saved photo.
  async function onPickPhoto(f: File | null) {
    setMsg(null);
    if (!f) return;
    if (!PHOTO_MIMES.includes(f.type)) { setMsg({ kind: 'err', text: 'Photo must be JPG, PNG, or WebP.' }); return; }
    if (f.size > PHOTO_MAX) { setMsg({ kind: 'err', text: 'Photo exceeds the 5 MB limit.' }); return; }
    setPreview(URL.createObjectURL(f));
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f);
      const res = await api.upload<{ photoUrl: string | null }>(`/api/staff/users/${userId}/photo`, form);
      setPhoto(res.photoUrl); setPreview(null);
      if (photoRef.current) photoRef.current.value = '';
      setMsg({ kind: 'ok', text: 'Photo updated.' });
      onPhotoChanged?.();
    } catch (err) {
      setPreview(null);
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Photo upload failed.' });
    } finally { setBusy(false); }
  }

  async function removePhoto() {
    setBusy(true); setMsg(null);
    try {
      await api.delete(`/api/staff/users/${userId}/photo`);
      setPhoto(null); setPreview(null);
      setMsg({ kind: 'ok', text: 'Photo removed.' });
      onPhotoChanged?.();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Could not remove the photo.' });
    } finally { setBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<ContractMeta>(`/api/staff/users/${userId}/contract`).catch(() => ({ hasContract: false } as ContractMeta)),
      api.get<{ text: string | null; setAt: string | null }>(`/api/staff/users/${userId}/job-description`).catch(() => ({ text: null, setAt: null })),
    ]).then(([c, j]) => {
      if (cancelled) return;
      setContract(c);
      setJd(j.text ?? '');
      setJdSetAt(j.setAt);
    }).finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userId]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ''; // allow re-selecting same file
    if (!f) return;
    setMsg(null);
    if (f.type !== 'application/pdf') { setMsg({ kind: 'err', text: 'Contract must be a PDF.' }); return; }
    if (f.size > MAX_BYTES) { setMsg({ kind: 'err', text: 'File exceeds the 10 MB limit.' }); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f);
      const meta = await api.upload<ContractMeta>(`/api/staff/users/${userId}/contract`, form);
      setContract(meta);
      setMsg({ kind: 'ok', text: 'Contract uploaded.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Upload failed.' });
    } finally { setBusy(false); }
  }

  async function viewContract() {
    setMsg(null);
    try {
      const { url } = await api.get<{ url: string }>(`/api/staff/users/${userId}/contract/download`);
      window.open(`${BACKEND}${url}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Could not open the contract.' });
    }
  }

  async function removeContract() {
    setMsg(null); setBusy(true);
    try {
      await api.delete(`/api/staff/users/${userId}/contract`);
      setContract({ hasContract: false });
      setMsg({ kind: 'ok', text: 'Contract removed.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Could not remove the contract.' });
    } finally { setBusy(false); }
  }

  async function saveJd() {
    setMsg(null); setBusy(true);
    try {
      const res = await api.put<{ text: string | null; setAt: string | null }>(`/api/staff/users/${userId}/job-description`, { text: jd });
      setJd(res.text ?? '');
      setJdSetAt(res.setAt);
      setMsg({ kind: 'ok', text: 'Job description saved.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl border border-gray-200 p-4 mb-5">
      <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">HR</h3>

      {msg && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.kind === 'ok' ? 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {!loaded ? (
        <div className="flex items-center gap-2 py-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          {/* Profile photo (admin) */}
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Profile photo</p>
            <div className="flex items-center gap-3">
              <StaffAvatar name={userName} photoUrl={preview ?? photo} size={48} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => photoRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-[#1e3a5f] hover:bg-gray-50 disabled:opacity-60">{busy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} {busy ? 'Uploading…' : (photo ? 'Replace' : 'Add photo')}</button>
                {photo && !busy && (
                  <button type="button" onClick={removePhoto} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"><Trash2 size={13} /></button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">JPG, PNG, or WebP. Max 5 MB. Saves as soon as you choose one.</p>
            <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)} className="hidden" />
          </div>

          {/* Contract */}
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Employment contract (PDF)</p>
            {contract?.hasContract ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                <div className="flex min-w-0 items-start gap-2">
                  <FileText size={16} className="mt-0.5 shrink-0 text-[#1e3a5f]/50" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#1e3a5f]">{contract.originalName}</p>
                    <p className="text-[11px] text-gray-400">{fmtBytes(contract.sizeBytes)}{contract.uploadedAt ? ` · ${formatDate(contract.uploadedAt)}` : ''}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={viewContract} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-[#1e3a5f] hover:bg-gray-50 disabled:opacity-60"><Eye size={13} /> View</button>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-[#1e3a5f] hover:bg-gray-50 disabled:opacity-60"><Upload size={13} /> Replace</button>
                  <button type="button" onClick={removeContract} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"><Trash2 size={13} /></button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#162d4a] disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload contract PDF
              </button>
            )}
            <input ref={fileRef} type="file" accept="application/pdf" onChange={onFile} className="hidden" />
          </div>

          {/* Job description */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Job description</p>
              {jdSetAt && <span className="text-[10px] text-gray-400">Updated {formatDate(jdSetAt)}</span>}
            </div>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              maxLength={10000}
              rows={5}
              placeholder="Describe this staff member's role and responsibilities…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
            <div className="mt-2">
              <button type="button" onClick={saveJd} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-sorena-gold px-4 py-2 text-xs font-semibold text-[#1e3a5f] hover:bg-sorena-gold/90 disabled:opacity-60">
                {busy ? <Loader2 size={14} className="animate-spin" /> : null} Save job description
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
