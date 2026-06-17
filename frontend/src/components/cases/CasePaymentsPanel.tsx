'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Banknote, Check, ClipboardCopy, CreditCard, Link2, Loader2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// Phase 6 — staff Payments tab. Mirrors CaseDocumentsPanel structure:
// useCallback fetch, useEffect on mount, refresh() after every mutation,
// same section card / error-banner / empty-state / list-row idioms.
//
// Talks to three case-keyed routes (all staff-guarded server-side):
//   GET  /payments/case/:caseId                       → PaymentRow[]
//   POST /payments/case/:caseId/consultation-link     → { url, free, consultationType }
//   POST /payments/case/:caseId/manual                → PaymentRow
//
// Money on the wire is integer cents. The list formats cents → dollars
// for display. The manual form accepts dollars from the user (string
// input, free-form) and converts to cents before sending — the backend
// DTO refuses anything not a positive integer, so client validation
// here only catches the obvious "0", "" or "abc" cases early.

interface PaymentRow {
  id:          string;
  amount:      number;
  currency:    string;
  status:      string;
  paymentType: string;
  createdAt:   string;
  isManual:    boolean;
}

interface ConsultationLinkResult {
  url:              string | null;
  free:             boolean;
  consultationType: string;
}

const CONSULTATION_TYPE_OPTIONS = [
  { value: 'GAP_CLOSING',            labelKey: 'gapClosing' },
  { value: 'ADMISSION_CONSULTATION', labelKey: 'admission' },
  { value: 'LIA_CONSULTATION',       labelKey: 'liaConsultation' },
  { value: 'ACCOUNT_OPENING',        labelKey: 'accountOpening' },
  { value: 'FREE_SESSION',           labelKey: 'freeSession' },
] as const;

function formatAmount(cents: number, currency: string): string {
  const dollars = (cents / 100).toFixed(2);
  return `${currency.toUpperCase()} ${dollars}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year:  'numeric',
      month: 'short',
      day:   'numeric',
    });
  } catch {
    return iso;
  }
}

export function CasePaymentsPanel({ caseId }: { caseId: string }) {
  const t = useTranslations();

  // List
  const [payments,   setPayments]   = useState<PaymentRow[] | null>(null);
  const [listError,  setListError]  = useState<string | null>(null);

  // Consultation-link form
  const [linkOpen,       setLinkOpen]       = useState(false);
  const [linkType,       setLinkType]       = useState<string>('ADMISSION_CONSULTATION');
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [linkError,      setLinkError]      = useState<string | null>(null);
  const [linkResult,     setLinkResult]     = useState<ConsultationLinkResult | null>(null);
  const [linkCopied,     setLinkCopied]     = useState(false);

  // Manual-payment form
  const [manualOpen,       setManualOpen]       = useState(false);
  const [manualAmount,     setManualAmount]     = useState('');
  const [manualCurrency,   setManualCurrency]   = useState('NZD');
  const [manualNote,       setManualNote]       = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError,      setManualError]      = useState<string | null>(null);

  const refresh = useCallback(() => {
    setListError(null);
    api
      .get<PaymentRow[]>(`/payments/case/${caseId}`)
      .then((rows) => setPayments(rows))
      .catch((err) =>
        setListError(
          err instanceof Error ? err.message : t('staff.cases.detail.payments.loadFailed'),
        ),
      );
  }, [caseId, t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resetLinkForm = () => {
    setLinkType('ADMISSION_CONSULTATION');
    setLinkError(null);
    setLinkResult(null);
    setLinkCopied(false);
  };

  const closeLinkForm = () => {
    setLinkOpen(false);
    resetLinkForm();
  };

  const resetManualForm = () => {
    setManualAmount('');
    setManualCurrency('NZD');
    setManualNote('');
    setManualError(null);
  };

  const closeManualForm = () => {
    setManualOpen(false);
    resetManualForm();
  };

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError(null);
    setLinkResult(null);
    setLinkCopied(false);
    setLinkSubmitting(true);
    try {
      const result = await api.post<ConsultationLinkResult>(
        `/payments/case/${caseId}/consultation-link`,
        { consultationType: linkType },
      );
      setLinkResult(result);
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : t('staff.cases.detail.payments.linkFailed'),
      );
    } finally {
      setLinkSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!linkResult?.url) return;
    try {
      await navigator.clipboard.writeText(linkResult.url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Older browsers / blocked clipboard — the URL field is still
      // selectable on focus, so the staff member can copy manually.
    }
  };

  const handleRecordManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);

    // Validate amount client-side. Backend DTO requires positive integer
    // cents — we accept dollar input here and convert.
    //
    // Number.isFinite blocks NaN, ±Infinity, and (combined with the > 0
    // check) negatives and zero. Empty/whitespace/non-numeric strings
    // become NaN via parseFloat — also caught.
    //
    // The +EPSILON nudge handles the IEEE-754 quirk where e.g. 1.005 * 100
    // evaluates to 100.49999999999999, which Math.round would floor to 100
    // and silently under-charge by 1 cent.
    const amountFloat = Number.parseFloat(manualAmount);
    if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
      setManualError(t('staff.cases.detail.payments.manualInvalidAmount'));
      return;
    }
    const amountCents = Math.round((amountFloat + Number.EPSILON) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      setManualError(t('staff.cases.detail.payments.manualInvalidAmount'));
      return;
    }

    setManualSubmitting(true);
    try {
      const trimmedNote = manualNote.trim();
      await api.post<PaymentRow>(`/payments/case/${caseId}/manual`, {
        amount:   amountCents,
        currency: manualCurrency.toLowerCase(),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      });
      toast.success(t('staff.cases.detail.payments.manualSaved'));
      closeManualForm();
      refresh();
    } catch (err) {
      setManualError(
        err instanceof Error ? err.message : t('staff.cases.detail.payments.manualFailed'),
      );
    } finally {
      setManualSubmitting(false);
    }
  };

  // Open one form at a time — opening one closes the other.
  const openLinkForm = () => {
    closeManualForm();
    setLinkOpen(true);
  };
  const openManualForm = () => {
    closeLinkForm();
    setManualOpen(true);
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            {t('staff.cases.detail.payments.heading')}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('staff.cases.detail.payments.subheading')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={linkOpen ? closeLinkForm : openLinkForm}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] transition-colors min-h-[48px]"
          >
            <Link2 size={16} />
            {t('staff.cases.detail.payments.createLink')}
          </button>
          <button
            type="button"
            onClick={manualOpen ? closeManualForm : openManualForm}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-[#1e3a5f]/30 text-[#1e3a5f] text-sm font-semibold hover:bg-[#1e3a5f]/5 transition-colors min-h-[48px]"
          >
            <Banknote size={16} />
            {t('staff.cases.detail.payments.recordManual')}
          </button>
        </div>
      </div>

      {/* Inline consultation-link form */}
      {linkOpen && (
        <div className="rounded-xl border border-gray-200 bg-[#faf8f3] p-4 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#1e3a5f]">
                {t('staff.cases.detail.payments.linkFormTitle')}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('staff.cases.detail.payments.linkFormHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={closeLinkForm}
              className="text-gray-400 hover:text-gray-700"
              aria-label={t('staff.cases.detail.payments.close')}
            >
              <X size={18} />
            </button>
          </div>

          {!linkResult && (
            <form onSubmit={handleCreateLink} className="space-y-3">
              <div>
                <label
                  htmlFor="payment-link-type"
                  className="block text-xs font-medium text-gray-700 mb-1"
                >
                  {t('staff.cases.detail.payments.consultationTypeLabel')}
                </label>
                <select
                  id="payment-link-type"
                  value={linkType}
                  onChange={(e) => setLinkType(e.target.value)}
                  disabled={linkSubmitting}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#c9a961]/40 disabled:opacity-60 min-h-[48px]"
                >
                  {CONSULTATION_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(`staff.cases.detail.payments.consultationType.${opt.labelKey}`)}
                    </option>
                  ))}
                </select>
              </div>

              {linkError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {linkError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeLinkForm}
                  disabled={linkSubmitting}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 min-h-[40px]"
                >
                  {t('staff.cases.detail.payments.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={linkSubmitting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] disabled:opacity-60 min-h-[40px]"
                >
                  {linkSubmitting && <Loader2 size={14} className="animate-spin" />}
                  {t('staff.cases.detail.payments.generate')}
                </button>
              </div>
            </form>
          )}

          {linkResult && !linkResult.free && linkResult.url && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                {t('staff.cases.detail.payments.linkReady')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={linkResult.url}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700 font-mono min-h-[48px]"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 px-4 py-3 rounded-xl bg-[#c9a961] text-white text-sm font-semibold hover:bg-[#b8985a] transition-colors min-h-[48px]"
                >
                  {linkCopied ? <Check size={14} /> : <ClipboardCopy size={14} />}
                  {linkCopied
                    ? t('staff.cases.detail.payments.copied')
                    : t('staff.cases.detail.payments.copy')}
                </button>
              </div>
              <button
                type="button"
                onClick={closeLinkForm}
                className="text-sm text-[#1e3a5f] font-medium hover:underline"
              >
                {t('staff.cases.detail.payments.done')}
              </button>
            </div>
          )}

          {linkResult && linkResult.free && (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#c9a961]/30 bg-[#c9a961]/10 px-4 py-3 text-sm text-[#1e3a5f]">
                {t('staff.cases.detail.payments.freeSessionInfo')}
              </div>
              <button
                type="button"
                onClick={closeLinkForm}
                className="text-sm text-[#1e3a5f] font-medium hover:underline"
              >
                {t('staff.cases.detail.payments.done')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inline manual-payment form */}
      {manualOpen && (
        <div className="rounded-xl border border-gray-200 bg-[#faf8f3] p-4 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#1e3a5f]">
                {t('staff.cases.detail.payments.manualFormTitle')}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('staff.cases.detail.payments.manualFormHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={closeManualForm}
              className="text-gray-400 hover:text-gray-700"
              aria-label={t('staff.cases.detail.payments.close')}
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleRecordManual} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="manual-amount"
                  className="block text-xs font-medium text-gray-700 mb-1"
                >
                  {t('staff.cases.detail.payments.amountLabel')}
                </label>
                <input
                  id="manual-amount"
                  type="text"
                  inputMode="decimal"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  placeholder="50.00"
                  disabled={manualSubmitting}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#c9a961]/40 disabled:opacity-60 min-h-[48px]"
                />
              </div>
              <div>
                <label
                  htmlFor="manual-currency"
                  className="block text-xs font-medium text-gray-700 mb-1"
                >
                  {t('staff.cases.detail.payments.currencyLabel')}
                </label>
                <input
                  id="manual-currency"
                  type="text"
                  value={manualCurrency}
                  onChange={(e) => setManualCurrency(e.target.value.toUpperCase().slice(0, 3))}
                  maxLength={3}
                  disabled={manualSubmitting}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 uppercase focus:outline-none focus:ring-2 focus:ring-[#c9a961]/40 disabled:opacity-60 min-h-[48px]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="manual-note"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                {t('staff.cases.detail.payments.noteLabel')}
              </label>
              <textarea
                id="manual-note"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder={t('staff.cases.detail.payments.notePlaceholder')}
                rows={2}
                maxLength={500}
                disabled={manualSubmitting}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#c9a961]/40 disabled:opacity-60"
              />
            </div>

            {manualError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {manualError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeManualForm}
                disabled={manualSubmitting}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 min-h-[40px]"
              >
                {t('staff.cases.detail.payments.cancel')}
              </button>
              <button
                type="submit"
                disabled={manualSubmitting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] disabled:opacity-60 min-h-[40px]"
              >
                {manualSubmitting && <Loader2 size={14} className="animate-spin" />}
                {t('staff.cases.detail.payments.save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {listError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 mb-4">
          {listError}
        </div>
      )}

      {payments === null && !listError && (
        <div className="py-12 text-center text-sm text-gray-500">
          {t('staff.cases.detail.payments.loading')}
        </div>
      )}

      {payments !== null && payments.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-[#faf8f3] p-8 text-center">
          <CreditCard size={28} className="mx-auto text-[#c9a961] mb-2" />
          <p className="text-sm text-gray-500">
            {t('staff.cases.detail.payments.empty')}
          </p>
        </div>
      )}

      {payments !== null && payments.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {payments.map((p) => (
            <li
              key={p.id}
              className="py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <CreditCard size={20} className="text-[#1e3a5f] mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {formatAmount(p.amount, p.currency)}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {p.status} · {formatDate(p.createdAt)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {p.isManual ? (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#c9a961]/15 text-[#8b7338]">
                    {t('staff.cases.detail.payments.badgeManual')}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#1e3a5f]/10 text-[#1e3a5f]">
                    {t('staff.cases.detail.payments.badgeStripe')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
