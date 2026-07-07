'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, Globe, Loader2, CheckCircle2, Eye, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

// Piece #3 — accountant "Payments to confirm" surface (FINANCE + OWNER).
//
// Lists invoices a client moved into the "processing" state by uploading a
// receipt (Piece #2). The accountant checks the bank, views the receipt, and
// confirms → the invoice flips SENT→PAID (same end-state as a Stripe payment),
// clearing the client's "we're confirming it" into "Payment received".

interface Row {
  invoiceId:     string;
  invoiceNumber: string;
  clientName:    string;
  caseId:        string | null;
  amountLabel:   string;
  method:        string | null; // 'bank' | 'exchange'
  uploadedAt:    string | null;
  receiptName:   string | null;
  hasReceipt:    boolean;
}

const METHOD_LABEL: Record<string, string> = {
  bank: 'Bank transfer',
  exchange: 'Partner exchange',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function PaymentsToConfirmClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(() => {
    api.get<Row[]>('/staff/payments/pending-confirmation')
      .then((r) => setRows(r))
      .catch(() => setError(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function viewReceipt(invoiceId: string) {
    setBusyId(invoiceId); setMsg(null);
    try {
      const { url } = await api.get<{ url: string }>(`/staff/payments/invoices/${invoiceId}/receipt`);
      const base =
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        'http://localhost:3001';
      window.open(`${base}${url}`, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not open the receipt.' });
    } finally { setBusyId(null); }
  }

  async function confirm(invoiceId: string, clientName: string, amountLabel: string) {
    if (!window.confirm(
      `Confirm ${amountLabel} received from ${clientName}?\n\nOnly do this after you've verified the funds landed in the bank. This marks the invoice PAID and opens the client's full access.`,
    )) return;
    setBusyId(invoiceId); setMsg(null);
    try {
      await api.post(`/staff/payments/invoices/${invoiceId}/confirm`, {});
      setMsg({ kind: 'ok', text: `Payment confirmed for ${clientName} — invoice marked PAID.` });
      load(); // row drops off the list (no longer processing)
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not confirm the payment.' });
    } finally { setBusyId(null); }
  }

  async function reject(invoiceId: string, clientName: string) {
    const reason = window.prompt(
      `Request a new receipt from ${clientName}?\n\nThis clears the uploaded receipt so the client can upload a new one. Optionally note why:`,
      '',
    );
    if (reason === null) return; // cancelled
    setBusyId(invoiceId); setMsg(null);
    try {
      await api.post(`/staff/payments/invoices/${invoiceId}/reject`, { reason: reason || undefined });
      setMsg({ kind: 'ok', text: `Receipt cleared for ${clientName} — they can upload a new one.` });
      load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Could not clear the receipt.' });
    } finally { setBusyId(null); }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-2 flex items-center gap-2">
        <CheckCircle2 size={20} className="text-sorena-navy" />
        <h1 className="text-2xl font-bold text-sorena-navy">Payments to confirm</h1>
      </div>
      <p className="mb-6 text-sm text-sorena-text/70">
        Clients who paid by bank transfer or partner exchange and uploaded a receipt. Check the bank,
        view the receipt, then confirm to mark the invoice paid.
      </p>

      {msg && (
        <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${msg.kind === 'ok' ? 'bg-sorena-jade/10 text-sorena-jade border border-sorena-jade/30' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {error && <p className="text-sm text-red-600">Couldn’t load payments. Please refresh.</p>}
      {!rows && !error && <div className="flex items-center gap-2 py-12 text-sorena-text/60"><Loader2 size={18} className="animate-spin" /> Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <CheckCircle2 size={28} className="mx-auto text-sorena-jade/50" />
          <p className="mt-3 text-sm text-sorena-text/60">Nothing awaiting confirmation right now.</p>
        </div>
      )}

      <div className="space-y-3">
        {rows?.map((r) => {
          const busy = busyId === r.invoiceId;
          const MethodIcon = r.method === 'exchange' ? Globe : Landmark;
          return (
            <div key={r.invoiceId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sorena-navy">{r.clientName}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-sorena-gold/20 px-2 py-0.5 text-[11px] font-medium text-[#8a6d10]">
                      <MethodIcon size={11} /> {r.method ? METHOD_LABEL[r.method] ?? r.method : '—'}
                    </span>
                  </div>
                  <p className="mt-1 text-lg font-bold tracking-tight text-sorena-navy">{r.amountLabel}</p>
                  <p className="text-xs text-sorena-text/55">
                    Invoice {r.invoiceNumber} · uploaded {fmtDate(r.uploadedAt)}
                  </p>
                  {r.receiptName && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-sorena-text/45">
                      <FileText size={11} /> {r.receiptName}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => viewReceipt(r.invoiceId)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-sorena-navy/20 px-3 py-2 text-sm font-semibold text-sorena-navy transition-colors hover:bg-sorena-navy/5 disabled:opacity-50"
                  >
                    <Eye size={15} /> View receipt
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => reject(r.invoiceId, r.clientName)}
                    className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    Request new
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => confirm(r.invoiceId, r.clientName, r.amountLabel)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-sorena-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sorena-navy/90 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                    Confirm payment
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
