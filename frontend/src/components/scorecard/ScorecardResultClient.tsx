'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Award, AlertTriangle, CheckCircle2, XCircle, Calendar, CreditCard,
  Sparkles, BookOpen, Lock, ArrowRight, Download,
} from 'lucide-react';
import { useLocaleStore } from '@/lib/stores/localeStore';
import { api } from '@/lib/api';
import { BAND_META, CATEGORY_META, RESULT_STRINGS, T } from '@/lib/scorecard/labels';
import type { ScorecardResultPayload } from '@/app/scorecard/result/page';

// PR-SCORECARD-2 — Public scorecard result rendering.
//
// Layout reproduces SAMPLE_Scoring_Report.pdf:
//   * Header: total score + band + execution eligibility
//   * Next best action card (gold-bordered, prominent)
//   * Malaysia callout (BAND_4/5/6 only)
//   * Category breakdown (4 progress bars)
//   * Hard stops (if any)
//   * Risk flags (if any)
//   * 5-gate execution check
//   * Full answer log (collapsible)

const BAND_COLOR_CLASSES: Record<string, { bg: string; text: string; border: string }> = {
  gray:    { bg: 'bg-gray-100',     text: 'text-gray-700',    border: 'border-gray-200' },
  blue:    { bg: 'bg-blue-50',      text: 'text-blue-800',    border: 'border-blue-200' },
  amber:   { bg: 'bg-amber-50',     text: 'text-amber-800',   border: 'border-amber-200' },
  orange:  { bg: 'bg-orange-50',    text: 'text-orange-800',  border: 'border-orange-200' },
  violet:  { bg: 'bg-violet-50',    text: 'text-violet-800',  border: 'border-violet-200' },
  emerald: { bg: 'bg-emerald-100',  text: 'text-emerald-800', border: 'border-emerald-200' },
};

export function ScorecardResultClient({ data }: { data: ScorecardResultPayload }) {
  const locale = useLocaleStore((s) => s.locale);
  const isRtl = locale === 'fa';
  const [openAnswerLog, setOpenAnswerLog] = useState(false);
  const [bookingClicked, setBookingClicked] = useState(!!data.consultationBookedAt);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const bandMeta = BAND_META[data.band];
  const colorClasses = BAND_COLOR_CLASSES[bandMeta?.color ?? 'gray'];
  const applicantName = data.answers?.full_name ?? '';
  const generatedDate = new Date(data.submittedAt).toLocaleDateString(
    isRtl ? 'fa-IR' : 'en-NZ',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  async function handleBookingClick() {
    setBookingError(null);
    try {
      await api.post(`/scorecard/${data.submissionId}/booking-opened`, {});
      setBookingClicked(true);
    } catch {
      setBookingError('Could not register your booking request. Please try again.');
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF8F3] py-10 px-4" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 md:p-8 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Award size={24} className="text-[#E8B923]" />
            <h1 className="text-2xl md:text-3xl font-extrabold text-[#1E3A5F]">
              {T(RESULT_STRINGS.headerTitle, locale)}
            </h1>
          </div>
          {applicantName && (
            <p className="text-base text-[#1E3A5F] font-semibold mb-1">{applicantName}</p>
          )}
          <p className="text-xs text-[#4A4A4A]/60">
            {T(RESULT_STRINGS.generatedOn, locale).replace('{date}', generatedDate)}
          </p>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Total score */}
            <div className="rounded-xl bg-[#1E3A5F] text-white p-5 text-center">
              <div className="text-xs uppercase tracking-wider opacity-80 mb-1">
                {T(RESULT_STRINGS.totalScoreLabel, locale)}
              </div>
              <div className="text-4xl font-extrabold">
                {data.totalScore}<span className="text-xl opacity-70"> / 100</span>
              </div>
            </div>
            {/* Band */}
            <div className={`rounded-xl ${colorClasses.bg} ${colorClasses.border} border p-5 text-center`}>
              <div className={`text-xs uppercase tracking-wider ${colorClasses.text} opacity-80 mb-1`}>
                {T(RESULT_STRINGS.bandLabel, locale)}
              </div>
              <div className={`text-xl font-extrabold ${colorClasses.text} leading-tight`}>
                {data.band.replace('BAND_', 'Band ')}
              </div>
              <div className={`text-xs ${colorClasses.text} opacity-80 mt-1`}>
                {bandMeta ? T(bandMeta.name, locale) : data.bandName}
              </div>
              <div className={`text-xs font-mono ${colorClasses.text} opacity-60 mt-0.5`}>
                {data.bandRange}
              </div>
            </div>
            {/* Eligibility */}
            <div className={`rounded-xl border p-5 text-center ${
              data.executionEligible
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <div className={`text-xs uppercase tracking-wider mb-2 ${
                data.executionEligible ? 'text-emerald-700' : 'text-gray-600'
              }`}>
                {data.executionEligible
                  ? T(RESULT_STRINGS.executionEligible, locale)
                  : T(RESULT_STRINGS.notYetEligible, locale)}
              </div>
              {data.executionEligible
                ? <CheckCircle2 size={28} className="text-emerald-600 mx-auto" />
                : <XCircle size={28} className="text-gray-500 mx-auto" />}
            </div>
          </div>
        </div>

        {/* Next best action */}
        <div className="bg-white rounded-2xl shadow-md border-2 border-[#E8B923]/50 p-6 md:p-8 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={18} className="text-[#E8B923]" />
            <h2 className="text-lg font-bold text-[#1E3A5F]">
              {T(RESULT_STRINGS.nextActionTitle, locale)}
            </h2>
          </div>
          <p className="text-base text-[#1E3A5F] font-semibold leading-relaxed mb-4">
            {isRtl ? data.nextActionTextFa : data.nextActionTextEn}
          </p>

          {/* Band 4-6 CTA */}
          {data.shouldShowBookingLink && (
            <div className="mt-4 pt-4 border-t border-[#E8B923]/30">
              <button
                type="button"
                onClick={handleBookingClick}
                disabled={bookingClicked}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#E8B923] text-[#1E3A5F] font-bold text-sm hover:bg-[#d4a91f] disabled:opacity-60 transition-colors"
              >
                <Calendar size={16} />
                {T(RESULT_STRINGS.bookFreeCta, locale)}
              </button>
              {bookingClicked && (
                <p className="mt-3 text-sm text-emerald-700 inline-flex items-center gap-1">
                  <CheckCircle2 size={14} /> {T(RESULT_STRINGS.bookFreeBackChannel, locale)}
                </p>
              )}
              {bookingError && (
                <p className="mt-3 text-sm text-red-600">{bookingError}</p>
              )}
            </div>
          )}

          {/* Band 3 payment */}
          {data.shouldShowPaymentLink && (
            <div className="mt-4 pt-4 border-t border-[#E8B923]/30">
              <p className="text-sm text-[#4A4A4A] mb-3 leading-relaxed">
                {T(RESULT_STRINGS.payGapBody, locale)}
              </p>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#1E3A5F] text-white font-bold text-sm opacity-70 cursor-not-allowed"
              >
                <CreditCard size={16} />
                {T(RESULT_STRINGS.payGapCta, locale)} ({T(RESULT_STRINGS.payGapAmount, locale)})
              </button>
              <p className="mt-3 text-xs text-[#4A4A4A]/60 italic">
                {T(RESULT_STRINGS.payGapComingSoon, locale)}
              </p>
            </div>
          )}

          {/* Bands 1-2 nurture */}
          {data.shouldShowNurtureMessage && (
            <div className="mt-4 pt-4 border-t border-[#E8B923]/30">
              <div className="inline-flex items-center gap-2 mb-2">
                <BookOpen size={16} className="text-[#1E3A5F]" />
                <span className="text-sm font-semibold text-[#1E3A5F]">
                  {T(RESULT_STRINGS.nurtureTitle, locale)}
                </span>
              </div>
              <p className="text-sm text-[#4A4A4A] leading-relaxed">
                {T(RESULT_STRINGS.nurtureBody, locale)}
              </p>
            </div>
          )}

          {/* Blocked (any hard stop) */}
          {data.nextAction === 'BLOCKED_HARD_STOP' && (
            <div className="mt-4 pt-4 border-t border-[#E8B923]/30">
              <div className="inline-flex items-center gap-2 mb-2">
                <Lock size={16} className="text-red-600" />
                <span className="text-sm font-semibold text-red-700">
                  {T(RESULT_STRINGS.blockedTitle, locale)}
                </span>
              </div>
              <p className="text-sm text-[#4A4A4A] leading-relaxed">
                {T(RESULT_STRINGS.blockedBody, locale)}
              </p>
            </div>
          )}
        </div>

        {/* Malaysia callout — Band 4-6 only */}
        {data.shouldShowMalaysiaCallout && (
          <div className="bg-emerald-50 rounded-2xl border-2 border-emerald-200 p-6 md:p-8 mb-6">
            <h2 className="text-lg font-bold text-emerald-900 mb-3 flex items-center gap-2">
              🇲🇾 {T(RESULT_STRINGS.malaysiaCalloutTitle, locale)}
            </h2>
            <p className="text-sm text-emerald-900 leading-relaxed">
              {T(RESULT_STRINGS.malaysiaCalloutBody, locale)}
            </p>
          </div>
        )}

        {/* Category breakdown */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-6">
          <h2 className="text-lg font-bold text-[#1E3A5F] mb-4">
            {T(RESULT_STRINGS.categoryBreakdown, locale)}
          </h2>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((cat) => {
              const meta = CATEGORY_META[cat];
              const score = data.categoryScores[cat] ?? 0;
              const pct = Math.round((score / meta.max) * 100);
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="font-semibold text-[#1E3A5F]">
                      {T(meta.name, locale)}
                    </span>
                    <span className="font-mono text-[#4A4A4A]">
                      {score} / {meta.max} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-[#E8B923]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Hard stops */}
        {data.hardStops.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6 md:p-8 mb-6">
            <h2 className="text-lg font-bold text-red-800 mb-4 flex items-center gap-2">
              <Lock size={18} /> {T(RESULT_STRINGS.hardStopsTitle, locale)}
            </h2>
            <ul className="space-y-3">
              {data.hardStops.map((h) => (
                <li key={h.code} className="rounded-xl border-2 border-red-200 bg-red-50/50 p-3.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-red-700 text-white">{h.code}</span>
                    <span className="font-bold text-red-900">{h.name}</span>
                  </div>
                  <p className="text-sm text-red-800 mb-1">{h.reason}</p>
                  <p className="text-xs text-red-900/80"><strong>Resolution:</strong> {h.resolution}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Risk flags */}
        {data.riskFlags.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 p-6 md:p-8 mb-6">
            <h2 className="text-lg font-bold text-amber-800 mb-3 flex items-center gap-2">
              <AlertTriangle size={18} /> {T(RESULT_STRINGS.riskFlagsTitle, locale)}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {data.riskFlags.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 5-gate check */}
        {data.executionEligible || Object.keys(data.gateResults).length > 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-6">
            <h2 className="text-lg font-bold text-[#1E3A5F] mb-4">
              {T(RESULT_STRINGS.fiveGateTitle, locale)}
            </h2>
            <ul className="space-y-1.5">
              {Object.entries(data.gateResults).map(([label, passed]) => (
                <li key={label} className="flex items-center gap-2 text-sm">
                  {passed
                    ? <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
                    : <XCircle size={14} className="text-red-600 flex-shrink-0" />}
                  <span className="text-[#1E3A5F]">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Full answer log */}
        {data.answers && Object.keys(data.answers).length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-6">
            <button
              type="button"
              onClick={() => setOpenAnswerLog((o) => !o)}
              className="text-sm font-semibold text-[#1E3A5F] hover:text-[#E8B923] inline-flex items-center gap-1"
            >
              {openAnswerLog ? '▾' : '▸'} {T(RESULT_STRINGS.fullAnswerLog, locale)}
            </button>
            {openAnswerLog && (
              <div className="mt-4 space-y-2">
                {Object.entries(data.answers).map(([k, v]) => (
                  <div key={k} className="text-sm border-b border-gray-50 pb-1.5 flex items-start justify-between gap-3">
                    <span className="font-mono text-xs text-[#4A4A4A]/60 flex-shrink-0">{k}</span>
                    <span className="text-[#1E3A5F] text-right">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PDF + back actions */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-gray-200 text-[#4A4A4A] text-sm font-medium opacity-60 cursor-not-allowed"
            title={T(RESULT_STRINGS.pdfComingSoon, locale)}
          >
            <Download size={14} /> {T(RESULT_STRINGS.downloadPdfCta, locale)}
          </button>
          <Link
            href="/student/dashboard"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#E8B923]"
          >
            {T(RESULT_STRINGS.backToDashboard, locale)} <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
