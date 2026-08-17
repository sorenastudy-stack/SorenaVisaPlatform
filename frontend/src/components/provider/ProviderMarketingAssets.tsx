'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Upload, FileText, Image as ImageIcon, Download, X, Clock3, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-PROVIDER-PORTAL — marketing material for Sorena's team.
//
// Not catalogue data: nothing here reaches a student through the platform. It is
// the brochure, the logo, the prospectus — files our marketing and recruitment
// people asked the institution for.
//
// The copy says who it is for, because "upload files here" next to a screen full
// of review-gated pricing would otherwise read as another submission that
// students eventually see.

interface Asset {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  label: string | null;
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  isActive: boolean;
  createdAt: string;
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.svg';
const MAX_BYTES = 20 * 1024 * 1024;

export function ProviderMarketingAssets() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get<{ assets: Asset[] }>('/provider/marketing')
      .then((r) => setAssets(r.assets))
      .catch((e) => setError(e?.message ?? 'Couldn’t load your files.'));
  }, []);
  useEffect(load, [load]);

  const upload = async (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error(`That file is ${Math.round(f.size / 1024 / 1024)} MB. Please keep it under 20 MB.`);
      return;
    }
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (label.trim()) fd.append('label', label.trim());
      await api.upload('/provider/marketing', fd);
      toast.success('Uploaded. Our team will take it from here.');
      setLabel('');
      if (inputRef.current) inputRef.current.value = '';
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'That file couldn’t be uploaded.');
    } finally { setBusy(null); }
  };

  const download = async (a: Asset) => {
    setBusy(a.id);
    try {
      // A fresh short-lived link each time — nothing durable is stored or shared.
      const r = await api.get<{ url: string }>(`/provider/marketing/${a.id}/download-url`);
      window.open(r.url, '_blank', 'noopener');
    } catch (e: any) {
      toast.error(e?.message ?? 'Couldn’t open that file.');
    } finally { setBusy(null); }
  };

  const remove = async (a: Asset) => {
    if (!window.confirm(`Remove “${a.label || a.fileName}” from your marketing files?`)) return;
    setBusy(a.id);
    try {
      await api.post(`/provider/marketing/${a.id}/remove`, {});
      toast.success('Removed from your list.');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'That couldn’t be removed.');
    } finally { setBusy(null); }
  };

  if (error) return <Card><CardContent className="p-5"><p className="text-sm text-red-600">{error}</p></CardContent></Card>;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Marketing materials</h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            Logos, brochures, your prospectus, campus photos — anything our marketing and recruitment
            team can use when they talk about you. These aren’t shown to students automatically.
          </p>
        </div>

        <div className="space-y-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is it? e.g. 2027 prospectus (optional)"
            className="min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm text-sorena-navy focus:border-[#1e3a5f] focus:outline-none"
          />
          <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-dashed border-gray-300 px-4 py-3 hover:border-[#1e3a5f]/40 hover:bg-[#faf8f3]">
            {busy === 'upload' ? <Loader2 size={18} className="animate-spin text-[#c9a961]" /> : <Upload size={18} className="shrink-0 text-[#c9a961]" />}
            <span className="text-sm text-gray-600">
              {busy === 'upload' ? 'Uploading…' : 'Choose a PDF or image…'}
            </span>
            <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" disabled={busy !== null}
              onChange={(e) => upload(e.target.files?.[0] ?? null)} />
          </label>
          <p className="text-xs text-gray-500">PDF, JPG, PNG, WebP or SVG · up to 20 MB.</p>
        </div>

        {!assets ? (
          <div className="flex items-center gap-2 py-6 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : assets.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-[#faf8f3]/50 px-4 py-6 text-center text-xs text-gray-500">
            Nothing uploaded yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {assets.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 p-3">
                <span className="shrink-0 text-[#c9a961]">
                  {a.contentType === 'application/pdf' ? <FileText size={18} /> : <ImageIcon size={18} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-sorena-navy">{a.label || a.fileName}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {a.label ? `${a.fileName} · ` : ''}{(a.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  a.reviewStatus === 'APPROVED'
                    ? 'border-[#15a86b]/40 bg-[#15a86b]/5 text-[#15a86b]'
                    : 'border-[#c9a961]/50 bg-[#faf8f3] text-[#8a6d10]'
                }`}>
                  {a.reviewStatus === 'APPROVED'
                    ? <><CheckCircle2 size={13} /> With our team</>
                    : <><Clock3 size={13} /> Received</>}
                </span>
                <button onClick={() => download(a)} disabled={busy === a.id} aria-label={`Download ${a.fileName}`}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-[#1e3a5f] hover:bg-[#faf8f3] disabled:opacity-40">
                  {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Open
                </button>
                <button onClick={() => remove(a)} disabled={busy === a.id} aria-label={`Remove ${a.fileName}`}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-[#1e3a5f] hover:bg-[#faf8f3] disabled:opacity-40">
                  <X size={14} /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
