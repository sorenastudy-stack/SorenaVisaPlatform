'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate as fmtDate } from '@/lib/date';
import { useTranslations } from 'next-intl';
import {
  Banknote, Check, ClipboardCopy, CreditCard, FileText, Link2, Loader2,
  ShieldCheck, ShieldAlert, ShieldQuestion, ThumbsDown, ThumbsUp, Wallet, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import {
  CASE_DOCUMENT_MIME_TYPES,
  getCaseDocumentDownloadUrl,
  isCaseDocumentMimeTypeAllowed,
  isCaseDocumentSizeAllowed,
  uploadCaseDocument,
} from '@/lib/case-documents';
import { useStaff } from '@/contexts/StaffContext';

// Phase 6 + 6.5 — staff Payments tab.
//
// Mirrors CaseDocumentsPanel structure: useCallback fetch, useEffect on
// mount, refresh() after every successful mutation, same section card /
// error-banner / empty-state / list-row idioms.
//
// Talks to four case- and payment-keyed routes (all staff-guarded):
//   GET  /payments/case/:caseId                       → PaymentRow[]
//   POST /payments/case/:caseId/consultation-link     → { url, free, consultationType }
//   POST /payments/case/:caseId/manual                → PaymentRow  (Phase 6.5: receiptDocumentId required)
//   POST /payments/:paymentId/confirm                 → updated row  (Phase 6.5, FINANCE/OWNER/ADMIN)
//   POST /payments/:paymentId/reject                  → updated row  (Phase 6.5, FINANCE/OWNER/ADMIN)
//
// Money on the wire is integer cents. The list formats cents → dollars
// for display. The manual form accepts dollars from the user (string
// input, free-form) and converts to cents with an EPSILON-safe round.
//
// Phase 6.5 — receipt upload runs FIRST (via the shared Phase 5 upload
// helper); only on a successful upload do we POST the payment. If the
// upload fails the payment is NOT recorded — staff see the upload
// error and can retry without a half-created Payment row.

interface PaymentRow {
  id:                  string;
  amount:              number;
  currency:            string;
  status:              string;
  paymentType:         string;
  createdAt:           string;
  isManual:            boolean;
  verificationStatus:  'PENDING' | 'CONFIRMED' | 'REJECTED';
  verifiedById:        string | null;
  verifiedByName:      string | null;
  verifiedAt:          string | null;
  verificationNote:    string | null;
  receiptDocumentId:   string | null;
}

interface ConsultationLinkResult {
  url:              string | null;
  free:             boolean;
  consultationType: string;
}

interface CustomLinkResult {
  url:      string;
  amount:   number;   // integer cents (so the success state can re-display
  currency: string;   // the formatted amount via the same formatAmount helper)
}

const CONSULTATION_TYPE_OPTIONS = [
  { value: 'GAP_CLOSING',            labelKey: 'gapClosing' },
  { value: 'ADMISSION_CONSULTATION', labelKey: 'admission' },
  { value: 'LIA_CONSULTATION',       labelKey: 'liaConsultation' },
  { value: 'ACCOUNT_OPENING',        labelKey: 'accountOpening' },
  { value: 'FREE_SESSION',           labelKey: 'freeSession' },
] as const;

const VERIFICATION_ROLES = new Set(['FINANCE', 'OWNER', 'ADMIN']);

// PR-ACCESS-GATE (Phase C) — roles allowed to GENERATE a payment link / custom
// link / record a manual payment. Mirrors the backend @Roles on POST
// /payments/case/:caseId/{consultation-link,custom-link,manual} EXACTLY, so a
// role that would be 403'd never sees the button. Deliberately excludes
// CLIENT_CONSULTANT (Client Officer): they must never generate a payment link.
const CREATE_PAYMENT_ROLES = new Set([
  'OWNER', 'SUPER_ADMIN', 'ADMIN', 'LIA', 'CONSULTANT', 'SUPPORT', 'FINANCE',
]);

function formatAmount(cents: number, currency: string): string {
  const dollars = (cents / 100).toFixed(2);
  return `${currency.toUpperCase()} ${dollars}`;
}

function formatDate(iso: string): string {
  // Day-first NZ style ("8 Jul 2026") via the shared helper.
  return fmtDate(iso);
}

type ManualProgress = 'idle' | 'uploading' | 'recording';

export function CasePaymentsPanel({ caseId }: { caseId: string }) {
  const t = useTranslations();
  const { me } = useStaff();
  const canVerify = !!me && VERIFICATION_ROLES.has(me.role);
  // Client Officers (and any non-listed role) never see the link/manual buttons.
  const canCreatePayment = !!me && CREATE_PAYMENT_ROLES.has(me.role);

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

  // Custom-amount link form — parallel sibling of the consultation-link
  // form above. Same shape (open/inputs/submitting/error/result/copied),
  // different inputs (raw dollar amount string + 3-letter currency) and
  // a different backend endpoint.
  const [customOpen,       setCustomOpen]       = useState(false);
  const [customAmount,     setCustomAmount]     = useState('');
  const [customCurrency,   setCustomCurrency]   = useState('NZD');
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [customError,      setCustomError]      = useState<string | null>(null);
  const [customResult,     setCustomResult]     = useState<CustomLinkResult | null>(null);
  const [customCopied,     setCustomCopied]     = useState(false);

  // Manual-payment form
  const [manualOpen,       setManualOpen]       = useState(false);
  const [manualAmount,     setManualAmount]     = useState('');
  const [manualCurrency,   setManualCurrency]   = useState('NZD');
  const [manualNote,       setManualNote]       = useState('');
  const [manualReceipt,    setManualReceipt]    = useState<File | null>(null);
  const [manualError,      setManualError]      = useState<string | null>(null);
  const [manualProgress,   setManualProgress]   = useState<ManualProgress>('idle');
  const receiptInputRef = useRef<HTMLInputElement | null>(null);

  // Per-row verification UI
  const [confirmingId,      setConfirmingId]      = useState<string | null>(null);
  const [rejectingId,       setRejectingId]       = useState<string | null>(null);
  const [rejectReason,      setRejectReason]      = useState('');
  const [rejectError,       setRejectError]       = useState<string | null>(null);
  const [rejectSubmitting,  setRejectSubmitting]  = useState(false);

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

  // ─── Link form helpers ────────────────────────────────────────────────

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
      // older browsers / blocked clipboard — URL field is still selectable
    }
  };

  // ─── Custom-amount link form helpers ──────────────────────────────────
  //
  // Mirrors the consultation-link flow but converts the staff-typed
  // dollar amount to integer cents before sending. The EPSILON nudge
  // handles the IEEE-754 quirk where e.g. 1.005 * 100 evaluates to
  // 100.4999… (same idiom the manual-payment form uses).
  //
  // Caps mirror the backend DTO: 1 ≤ amountCents ≤ 1,000,000 (=
  // NZD 10,000.00). The frontend rejects out-of-range before any
  // network call to keep the staff feedback inline + fast; the DTO
  // is the authoritative cap.

  const resetCustomForm = () => {
    setCustomAmount('');
    setCustomCurrency('NZD');
    setCustomError(null);
    setCustomResult(null);
    setCustomCopied(false);
  };

  const closeCustomForm = () => {
    setCustomOpen(false);
    resetCustomForm();
  };

  const handleCreateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustomError(null);
    setCustomResult(null);
    setCustomCopied(false);

    const amountFloat = Number.parseFloat(customAmount);
    if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
      setCustomError(t('staff.cases.detail.payments.manualInvalidAmount'));
      return;
    }
    const amountCents = Math.round((amountFloat + Number.EPSILON) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      setCustomError(t('staff.cases.detail.payments.manualInvalidAmount'));
      return;
    }
    if (amountCents > 1_000_000) {
      setCustomError(t('staff.cases.detail.payments.customAmountTooLarge'));
      return;
    }

    setCustomSubmitting(true);
    try {
      const result = await api.post<CustomLinkResult>(
        `/payments/case/${caseId}/custom-link`,
        {
          amount:   amountCents,
          currency: customCurrency.toLowerCase(),
        },
      );
      setCustomResult(result);
    } catch (err) {
      setCustomError(
        err instanceof Error ? err.message : t('staff.cases.detail.payments.customLinkFailed'),
      );
    } finally {
      setCustomSubmitting(false);
    }
  };

  const handleCopyCustom = async () => {
    if (!customResult?.url) return;
    try {
      await navigator.clipboard.writeText(customResult.url);
      setCustomCopied(true);
      window.setTimeout(() => setCustomCopied(false), 2000);
    } catch {
      // older browsers / blocked clipboard — URL field is still selectable
    }
  };

  // ─── Manual-payment helpers ───────────────────────────────────────────

  const resetManualForm = () => {
    setManualAmount('');
    setManualCurrency('NZD');
    setManualNote('');
    setManualReceipt(null);
    setManualError(null);
    setManualProgress('idle');
    if (receiptInputRef.current) {
      receiptInputRef.current.value = '';
    }
  };

  const closeManualForm = () => {
    setManualOpen(false);
    resetManualForm();
  };

  const pickReceipt = () => {
    receiptInputRef.current?.click();
  };

  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!isCaseDocumentMimeTypeAllowed(file.type)) {
      setManualError(t('staff.cases.detail.payments.receiptInvalidType'));
      return;
    }
    if (!isCaseDocumentSizeAllowed(file.size)) {
      setManualError(t('staff.cases.detail.payments.receiptTooLarge'));
      return;
    }
    setManualError(null);
    setManualReceipt(file);
  };

  const handleRecordManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);

    // Amount validation — Number.isFinite blocks NaN/Infinity; > 0 blocks
    // negatives and zero. The +EPSILON nudge handles the IEEE-754 quirk
    // where e.g. 1.005 * 100 evaluates to 100.4999… and would under-charge.
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

    // Receipt required — block submit before any network work happens.
    if (!manualReceipt) {
      setManualError(t('staff.cases.detail.payments.receiptMissing'));
      return;
    }

    // Step 1 — upload the receipt via the shared Phase 5 helper. If this
    // throws, we DO NOT record the payment; staff see the upload error
    // and can fix the file. No half-created Payment row.
    setManualProgress('uploading');
    let receiptDocumentId: string;
    try {
      receiptDocumentId = await uploadCaseDocument(caseId, manualReceipt);
    } catch (err) {
      setManualError(
        err instanceof Error ? err.message : t('staff.cases.detail.payments.receiptUploadFailed'),
      );
      setManualProgress('idle');
      return;
    }

    // Step 2 — record the payment, threading the just-uploaded receipt id.
    setManualProgress('recording');
    try {
      const trimmedNote = manualNote.trim();
      await api.post<PaymentRow>(`/payments/case/${caseId}/manual`, {
        amount:            amountCents,
        currency:          manualCurrency.toLowerCase(),
        ...(trimmedNote ? { note: trimmedNote } : {}),
        receiptDocumentId,
      });
      toast.success(t('staff.cases.detail.payments.manualSaved'));
      closeManualForm();
      refresh();
    } catch (err) {
      setManualError(
        err instanceof Error ? err.message : t('staff.cases.detail.payments.manualFailed'),
      );
      setManualProgress('idle');
    }
  };

  // ─── Confirm / Reject ────────────────────────────────────────────────

  const handleConfirm = async (paymentId: string) => {
    setConfirmingId(paymentId);
    try {
      await api.post(`/payments/${paymentId}/confirm`, {});
      toast.success(t('staff.cases.detail.payments.confirmed'));
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        // Two staff acted at once — refresh so the row reflects the
        // other person's decision, and let them know calmly.
        toast.message(t('staff.cases.detail.payments.alreadyReviewed'));
        refresh();
      } else {
        toast.error(
          err instanceof Error ? err.message : t('staff.cases.detail.payments.confirmFailed'),
        );
      }
    } finally {
      setConfirmingId(null);
    }
  };

  const startReject = (paymentId: string) => {
    setRejectingId(paymentId);
    setRejectReason('');
    setRejectError(null);
  };

  const cancelReject = () => {
    setRejectingId(null);
    setRejectReason('');
    setRejectError(null);
  };

  const submitReject = async () => {
    if (!rejectingId) return;
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectError(t('staff.cases.detail.payments.rejectReasonMissing'));
      return;
    }
    setRejectSubmitting(true);
    try {
      await api.post(`/payments/${rejectingId}/reject`, { note: trimmed });
      toast.success(t('staff.cases.detail.payments.rejected'));
      cancelReject();
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        toast.message(t('staff.cases.detail.payments.alreadyReviewed'));
        cancelReject();
        refresh();
      } else {
        setRejectError(
          err instanceof Error ? err.message : t('staff.cases.detail.payments.rejectFailed'),
        );
      }
    } finally {
      setRejectSubmitting(false);
    }
  };

  // ─── Receipt view (reuses Phase 5 presigned-GET) ─────────────────────

  const handleViewReceipt = async (documentId: string) => {
    try {
      const url = await getCaseDocumentDownloadUrl(caseId, documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('staff.cases.detail.payments.viewReceiptFailed'),
      );
    }
  };

  // ─── Header button state ─────────────────────────────────────────────

  const openLinkForm = () => {
    closeCustomForm();
    closeManualForm();
    setLinkOpen(true);
  };
  const openCustomForm = () => {
    closeLinkForm();
    closeManualForm();
    setCustomOpen(true);
  };
  const openManualForm = () => {
    closeLinkForm();
    closeCustomForm();
    setManualOpen(true);
  };

  const manualSubmitDisabled =
    manualProgress !== 'idle' || !manualReceipt || !manualAmount.trim();

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
        {/* PR-ACCESS-GATE (Phase C) — link/manual generation is hidden for roles
            the backend would 403 (notably CLIENT_CONSULTANT / Client Officer). */}
        {canCreatePayment && (
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
              onClick={customOpen ? closeCustomForm : openCustomForm}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] transition-colors min-h-[48px]"
            >
              <Wallet size={16} />
              {t('staff.cases.detail.payments.createCustomLink')}
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
        )}
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
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-60 min-h-[48px]"
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
                  className="inline-flex items-center gap-1.5 px-4 py-3 rounded-xl bg-[#F3CE49] text-white text-sm font-semibold hover:bg-[#b8985a] transition-colors min-h-[48px]"
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
              <div className="rounded-xl border border-[#F3CE49]/30 bg-[#F3CE49]/10 px-4 py-3 text-sm text-[#1e3a5f]">
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

      {/* Inline custom-amount link form */}
      {customOpen && (
        <div className="rounded-xl border border-gray-200 bg-[#faf8f3] p-4 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#1e3a5f]">
                {t('staff.cases.detail.payments.customLinkFormTitle')}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('staff.cases.detail.payments.customLinkFormHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={closeCustomForm}
              className="text-gray-400 hover:text-gray-700"
              aria-label={t('staff.cases.detail.payments.close')}
            >
              <X size={18} />
            </button>
          </div>

          {!customResult && (
            <form onSubmit={handleCreateCustom} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="custom-link-amount"
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    {t('staff.cases.detail.payments.amountLabel')}
                  </label>
                  <input
                    id="custom-link-amount"
                    type="text"
                    inputMode="decimal"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="50.00"
                    disabled={customSubmitting}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-60 min-h-[48px]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="custom-link-currency"
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    {t('staff.cases.detail.payments.currencyLabel')}
                  </label>
                  <input
                    id="custom-link-currency"
                    type="text"
                    value={customCurrency}
                    onChange={(e) => setCustomCurrency(e.target.value.toUpperCase().slice(0, 3))}
                    maxLength={3}
                    disabled={customSubmitting}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 uppercase focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-60 min-h-[48px]"
                  />
                </div>
              </div>

              {customError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {customError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCustomForm}
                  disabled={customSubmitting}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 min-h-[40px]"
                >
                  {t('staff.cases.detail.payments.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={customSubmitting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] disabled:opacity-60 min-h-[40px]"
                >
                  {customSubmitting && <Loader2 size={14} className="animate-spin" />}
                  {t('staff.cases.detail.payments.generate')}
                </button>
              </div>
            </form>
          )}

          {customResult && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                {t('staff.cases.detail.payments.linkReady')}{' '}
                <span className="font-semibold">
                  {formatAmount(customResult.amount, customResult.currency)}
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={customResult.url}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700 font-mono min-h-[48px]"
                />
                <button
                  type="button"
                  onClick={handleCopyCustom}
                  className="inline-flex items-center gap-1.5 px-4 py-3 rounded-xl bg-[#F3CE49] text-white text-sm font-semibold hover:bg-[#b8985a] transition-colors min-h-[48px]"
                >
                  {customCopied ? <Check size={14} /> : <ClipboardCopy size={14} />}
                  {customCopied
                    ? t('staff.cases.detail.payments.copied')
                    : t('staff.cases.detail.payments.copy')}
                </button>
              </div>
              <button
                type="button"
                onClick={closeCustomForm}
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
                  disabled={manualProgress !== 'idle'}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-60 min-h-[48px]"
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
                  disabled={manualProgress !== 'idle'}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900 uppercase focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-60 min-h-[48px]"
                />
              </div>
            </div>

            {/* Receipt — required */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {t('staff.cases.detail.payments.receiptLabel')}
              </label>
              <p className="text-xs text-gray-500 mb-2">
                {t('staff.cases.detail.payments.receiptHint')}
              </p>
              <input
                ref={receiptInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleReceiptChange}
                className="hidden"
              />
              {!manualReceipt ? (
                <button
                  type="button"
                  onClick={pickReceipt}
                  disabled={manualProgress !== 'idle'}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-[#1e3a5f]/30 text-[#1e3a5f] text-sm font-semibold hover:bg-[#1e3a5f]/5 transition-colors min-h-[48px] disabled:opacity-60"
                >
                  <FileText size={16} />
                  {t('staff.cases.detail.payments.receiptPickButton')}
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
                  <FileText size={16} className="text-[#1e3a5f] flex-shrink-0" />
                  <span className="text-sm text-gray-900 truncate min-w-0 flex-1">
                    {manualReceipt.name}
                  </span>
                  <button
                    type="button"
                    onClick={pickReceipt}
                    disabled={manualProgress !== 'idle'}
                    className="text-xs font-medium text-[#1e3a5f] hover:underline disabled:opacity-60"
                  >
                    {t('staff.cases.detail.payments.receiptChange')}
                  </button>
                </div>
              )}
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
                disabled={manualProgress !== 'idle'}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-60"
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
                disabled={manualProgress !== 'idle'}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 min-h-[40px]"
              >
                {t('staff.cases.detail.payments.cancel')}
              </button>
              <button
                type="submit"
                disabled={manualSubmitDisabled}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold hover:bg-[#162d4a] disabled:opacity-60 min-h-[40px]"
              >
                {manualProgress !== 'idle' && <Loader2 size={14} className="animate-spin" />}
                {manualProgress === 'uploading'
                  ? t('staff.cases.detail.payments.savingUpload')
                  : manualProgress === 'recording'
                    ? t('staff.cases.detail.payments.savingRecord')
                    : t('staff.cases.detail.payments.save')}
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
          <CreditCard size={28} className="mx-auto text-[#b8941f] mb-2" />
          <p className="text-sm text-gray-500">
            {t('staff.cases.detail.payments.empty')}
          </p>
        </div>
      )}

      {payments !== null && payments.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {payments.map((p) => {
            const isPending   = p.verificationStatus === 'PENDING';
            const isConfirmed = p.verificationStatus === 'CONFIRMED';
            const isRejected  = p.verificationStatus === 'REJECTED';
            const showRejectForm = rejectingId === p.id;

            return (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <CreditCard size={20} className="text-[#1e3a5f] mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">
                        {formatAmount(p.amount, p.currency)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {p.status} · {formatDate(p.createdAt)}
                      </div>

                      {/* Verification meta line */}
                      {isConfirmed && (
                        <div className="text-xs text-emerald-700 mt-1">
                          {p.verifiedByName
                            ? t('staff.cases.detail.payments.verification.confirmedBy', {
                                name: p.verifiedByName,
                                date: p.verifiedAt ? formatDate(p.verifiedAt) : '',
                              })
                            : t('staff.cases.detail.payments.verification.confirmed')}
                        </div>
                      )}
                      {isRejected && (
                        <div className="text-xs text-rose-700 mt-1">
                          {p.verifiedByName
                            ? t('staff.cases.detail.payments.verification.rejectedBy', {
                                name: p.verifiedByName,
                              })
                            : t('staff.cases.detail.payments.verification.rejected')}
                          {p.verificationNote && (
                            <span className="block italic mt-0.5">
                              {t('staff.cases.detail.payments.verification.rejectedReason')}: {p.verificationNote}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Receipt link */}
                      {p.receiptDocumentId && (
                        <button
                          type="button"
                          onClick={() => handleViewReceipt(p.receiptDocumentId!)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] hover:underline mt-1"
                        >
                          <FileText size={12} />
                          {t('staff.cases.detail.payments.viewReceipt')}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {/* Verification badge */}
                      {isPending && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                          <ShieldQuestion size={12} />
                          {t('staff.cases.detail.payments.verification.pending')}
                        </span>
                      )}
                      {isConfirmed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                          <ShieldCheck size={12} />
                          {t('staff.cases.detail.payments.verification.confirmed')}
                        </span>
                      )}
                      {isRejected && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
                          <ShieldAlert size={12} />
                          {t('staff.cases.detail.payments.verification.rejected')}
                        </span>
                      )}
                      {/* Source badge */}
                      {p.isManual ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F3CE49]/15 text-[#8b7338]">
                          {t('staff.cases.detail.payments.badgeManual')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#1e3a5f]/10 text-[#1e3a5f]">
                          {t('staff.cases.detail.payments.badgeStripe')}
                        </span>
                      )}
                    </div>

                    {/* Confirm / Reject — only for PENDING and only if the
                        signed-in user holds a verification role. Other staff
                        see the badge but no action affordance. */}
                    {isPending && canVerify && !showRejectForm && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirm(p.id)}
                          disabled={confirmingId === p.id}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-[#1e3a5f] hover:bg-[#162d4a] disabled:opacity-60 transition-colors min-h-[36px]"
                        >
                          {confirmingId === p.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <ThumbsUp size={12} />}
                          {t('staff.cases.detail.payments.confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => startReject(p.id)}
                          disabled={confirmingId === p.id}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50 disabled:opacity-60 transition-colors min-h-[36px]"
                        >
                          <ThumbsDown size={12} />
                          {t('staff.cases.detail.payments.reject')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline reject reason form */}
                {showRejectForm && (
                  <div className="mt-3 rounded-xl border border-gray-200 bg-[#faf8f3] p-3 space-y-3">
                    <div>
                      <label
                        htmlFor={`reject-reason-${p.id}`}
                        className="block text-xs font-medium text-gray-700 mb-1"
                      >
                        {t('staff.cases.detail.payments.rejectReasonLabel')}
                      </label>
                      <textarea
                        id={`reject-reason-${p.id}`}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder={t('staff.cases.detail.payments.rejectReasonPlaceholder')}
                        rows={2}
                        maxLength={500}
                        disabled={rejectSubmitting}
                        autoFocus
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40 disabled:opacity-60"
                      />
                    </div>

                    {rejectError && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {rejectError}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelReject}
                        disabled={rejectSubmitting}
                        className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 min-h-[40px]"
                      >
                        {t('staff.cases.detail.payments.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={submitReject}
                        disabled={rejectSubmitting}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-60 min-h-[40px]"
                      >
                        {rejectSubmitting && <Loader2 size={14} className="animate-spin" />}
                        {t('staff.cases.detail.payments.rejectSubmit')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
