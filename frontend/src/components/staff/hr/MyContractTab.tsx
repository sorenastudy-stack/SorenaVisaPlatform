'use client';

import { useEffect, useState } from 'react';
import { FileText, Download, Eye, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/date';

// PR-STAFF-HR (Phase 3) — "My Contract" tab. Read-only self-view: the staff
// member sees only their OWN contract (backend scopes to req.user). Bytes are
// served via a short-lived signed-JWT URL (never public), same as student docs.

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

interface ContractMeta {
  hasContract: boolean;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedAt?: string;
}

function fmtBytes(n?: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MyContractTab() {
  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<ContractMeta>('/staff/me/contract')
      .then((m) => { if (!cancelled) setMeta(m); })
      .catch(() => { if (!cancelled) setErr('Could not load your contract.'); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  async function open(download: boolean) {
    setBusy(true); setErr(null);
    try {
      const { url } = await api.get<{ url: string; expiresInSeconds: number }>('/staff/me/contract/download');
      const full = `${BACKEND}${url}`;
      if (download) {
        const a = document.createElement('a');
        a.href = full;
        a.download = meta?.originalName || 'contract.pdf';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } else {
        window.open(full, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not open the contract.');
    } finally { setBusy(false); }
  }

  if (!loaded) {
    return <div className="flex items-center gap-2 py-8 text-sm text-sorena-text/50"><Loader2 size={16} className="animate-spin" /> Loading…</div>;
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm">
      <h2 className="text-sm font-bold uppercase tracking-wide text-sorena-text/60">My contract</h2>
      {err && <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">{err}</div>}

      {!meta?.hasContract ? (
        <p className="mt-4 text-sm text-sorena-text/50">No contract has been uploaded for you yet. Your administrator will add it here.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FileText size={20} className="mt-0.5 shrink-0 text-sorena-navy/50" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-sorena-navy">{meta.originalName}</p>
              <p className="text-xs text-sorena-text/50">
                PDF · {fmtBytes(meta.sizeBytes)}{meta.uploadedAt ? ` · uploaded ${formatDate(meta.uploadedAt)}` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" disabled={busy} onClick={() => open(false)} className="inline-flex items-center gap-1.5 rounded-xl bg-sorena-gold px-4 py-2 text-sm font-semibold text-sorena-navy shadow-sm transition-all hover:bg-sorena-gold/90 disabled:opacity-60">
              <Eye size={15} /> View
            </button>
            <button type="button" disabled={busy} onClick={() => open(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-sorena-text/70 hover:border-sorena-navy/40 hover:text-sorena-navy disabled:opacity-60">
              <Download size={15} /> Download
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
