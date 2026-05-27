'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Award, AlertTriangle, CheckCircle2, XCircle, Calendar, CreditCard,
  Sparkles, BookOpen, Lock, ArrowRight, Download, ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { BAND_META, CATEGORY_META, RESULT_STRINGS } from '@/lib/scorecard/labels';
import { BOOKING_URLS } from '@/lib/scorecard/booking-urls';
import type { ScorecardResultPayload } from '@/app/scorecard/result/page';

// PR-SCORECARD-2 — Public scorecard result rendering.
//
// Fix 4: Malaysia callout heading no longer uses the 🇲🇾 flag emoji
//        (renders as raw "MY" text on Windows browsers without an
//        emoji font for regional indicator symbols). Plain heading.
// Fix 5: gateResults is now a sorted array — frontend just iterates.
// Fix 7: Bands 4-6 + Band 3 render real CTA buttons that fire the
//        booking-opened audit row AND open the placeholder URL in a
//        new tab. Real Wix / Stripe URLs land in PR-SCORECARD-4 / 5.
// Fix 9: scorecard pages render in English only.

const BAND_COLOR_CLASSES: Record<string, { bg: string; text: string; border: string }> = {
  gray:    { bg: 'bg-gray-100',     text: 'text-gray-700',    border: 'border-gray-200' },
  blue:    { bg: 'bg-blue-50',      text: 'text-blue-800',    border: 'border-blue-200' },
  amber:   { bg: 'bg-amber-50',     text: 'text-amber-800',   border: 'border-amber-200' },
  orange:  { bg: 'bg-orange-50',    text: 'text-orange-800',  border: 'border-orange-200' },
  violet:  { bg: 'bg-violet-50',    text: 'text-violet-800',  border: 'border-violet-200' },
  emerald: { bg: 'bg-emerald-100',  text: 'text-emerald-800', border: 'border-emerald-200' },
};

export function ScorecardResultClient({ data }: { data: ScorecardResultPayload }) {
  const [openAnswerLog, setOpenAnswerLog] = useState(false);
  const [bookingClicked, setBookingClicked] = useState(!!data.consultationBookedAt);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const bandMeta = BAND_META[data.band];
  const colorClasses = BAND_COLOR_CLASSES[bandMeta?.color ?? 'gray'];
  const applicantName = data.answers?.full_name ?? '';
  const generatedDate = new Date(data.submittedAt).toLocaleDateString('en-NZ', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Fix 7: shared handler — logs the intent server-side, then opens
  // the placeholder URL in a new tab. We open the tab BEFORE the
  // network call so popup blockers don't block it (browsers reject
  // window.open() that wasn't called synchronously in a click handler).
  async function handleBookingNavigate(targetUrl: string) {
    setBookingError(null);
    // Open synchronously to dodge popup blockers.
    const w = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    try {
      await api.post(`/scorecard/${data.submissionId}/booking-opened`, {});
      setBookingClicked(true);
    } catch {
      setBookingError(RESULT_STRINGS.bookingError);
      // Even if logging fails, the user gets the booking page — don't
      // close their tab. We'll surface the error inline so they can
      // retry, but the booking flow is unimpeded.
      void w;
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF8F3] py-10 px-4">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 md:p-8 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Award size={24} className="text-[#E8B923]" />
            <h1 className="text-2xl md:text-3xl font-extrabold text-[#1E3A5F]">
              {RESULT_STRINGS.headerTitle}
            </h1>
          </div>
          {applicantName && (
            <p className="text-base text-[#1E3A5F] font-semibold mb-1">{applicantName}</p>
          )}
          <p className="text-xs text-[#4A4A4A]/60">
            {RESULT_STRINGS.generatedOn.replace('{date}', generatedDate)}
          </p>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Total score */}
            <div className="rounded-xl bg-[#1E3A5F] text-white p-5 text-center">
              <div className="text-xs uppercase tracking-wider opacity-80 mb-1">
                {RESULT_STRINGS.totalScoreLabel}
              </div>
              <div className="text-4xl font-extrabold">
                {data.totalScore}<span className="text-xl opacity-70"> / 100</span>
              </div>
            </div>
            {/* Band */}
            <div className={`rounded-xl ${colorClasses.bg} ${colorClasses.border} border p-5 text-center`}>
              <div className={`text-xs uppercase tracking-wider ${colorClasses.text} opacity-80 mb-1`}>
                {RESULT_STRINGS.bandLabel}
              </div>
              <div className={`text-xl font-extrabold ${colorClasses.text} leading-tight`}>
                {data.band.replace('BAND_', 'Band ')}
              </div>
              <div className={`text-xs ${colorClasses.text} opacity-80 mt-1`}>
                {bandMeta ? bandMeta.name : data.bandName}
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
                  ? RESULT_STRINGS.executionEligible
                  : RESULT_STRINGS.notYetEligible}
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
              {RESULT_STRINGS.nextActionTitle}
            </h2>
          </div>
          <p className="text-base text-[#1E3A5F] font-semibold leading-relaxed mb-4">
            {data.nextActionTextEn}
          </p>

          {/* Bands 4-6 free 15-min CTA (Fix 7) */}
          {data.shouldShowBookingLink && (
            <div className="mt-4 pt-4 border-t border-[#E8B923]/30">
              <button
                type="button"
                onClick={() => handleBookingNavigate(BOOKING_URLS.FREE_15MIN)}
                style={{ minHeight: 56 }}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-4 rounded-xl bg-[#E8B923] text-[#1E3A5F] font-bold text-base hover:bg-[#d4a91f] transition-colors shadow-md"
              >
                <Calendar size={18} />
                {RESULT_STRINGS.bookFreeCta}
                <ExternalLink size={14} />
              </button>
              <p className="mt-3 text-sm text-[#4A4A4A]/70 leading-relaxed">
                {RESULT_STRINGS.bookFreeSubtitle}
              </p>
              {bookingClicked && (
                <p className="mt-2 text-sm text-emerald-700 inline-flex items-center gap-1">
                  <CheckCircle2 size={14} /> {RESULT_STRINGS.bookFreeRecorded}
                </p>
              )}
              {bookingError && (
                <p className="mt-2 text-sm text-red-600">{bookingError}</p>
              )}
            </div>
          )}

          {/* Band 3 paid Gap-Closing CTA (Fix 7) */}
          {data.shouldShowPaymentLink && (
            <div className="mt-4 pt-4 border-t border-[#E8B923]/30">
              <p className="text-sm text-[#4A4A4A] mb-3 leading-relaxed">
                {RESULT_STRINGS.payGapBody}
              </p>
              <button
                type="button"
                onClick={() => handleBookingNavigate(BOOKING_URLS.GAP_CLOSING_PAYMENT)}
                style={{ minHeight: 56 }}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-4 rounded-xl bg-[#E8B923] text-[#1E3A5F] font-bold text-base hover:bg-[#d4a91f] transition-colors shadow-md"
              >
                <CreditCard size={18} />
                {RESULT_STRINGS.payGapCta}
                <ExternalLink size={14} />
              </button>
              <p className="mt-3 text-sm text-[#4A4A4A]/70 leading-relaxed">
                {RESULT_STRINGS.payGapSubtitle}
              </p>
              {bookingClicked && (
                <p className="mt-2 text-sm text-emerald-700 inline-flex items-center gap-1">
                  <CheckCircle2 size={14} /> {RESULT_STRINGS.payGapRecorded}
                </p>
              )}
              {bookingError && (
                <p className="mt-2 text-sm text-red-600">{bookingError}</p>
              )}
            </div>
          )}

          {/* Bands 1-2 nurture (no CTA per Fix 7) */}
          {data.shouldShowNurtureMessage && (
            <div className="mt-4 pt-4 border-t border-[#E8B923]/30">
              <div className="inline-flex items-center gap-2 mb-2">
                <BookOpen size={16} className="text-[#1E3A5F]" />
                <span className="text-sm font-semibold text-[#1E3A5F]">
                  {RESULT_STRINGS.nurtureTitle}
                </span>
              </div>
              <p className="text-sm text-[#4A4A4A] leading-relaxed">
                {RESULT_STRINGS.nurtureBody}
              </p>
            </div>
          )}

          {/* Blocked (any hard stop, no CTA per Fix 7) */}
          {data.nextAction === 'BLOCKED_HARD_STOP' && (
            <div className="mt-4 pt-4 border-t border-[#E8B923]/30">
              <div className="inline-flex items-center gap-2 mb-2">
                <Lock size={16} className="text-red-600" />
                <span className="text-sm font-semibold text-red-700">
                  {RESULT_STRINGS.blockedTitle}
                </span>
              </div>
              <p className="text-sm text-[#4A4A4A] leading-relaxed">
                {RESULT_STRINGS.blockedBody}
              </p>
            </div>
          )}
        </div>

        {/* Malaysia callout (Fix 4: no flag emoji) */}
        {data.shouldShowMalaysiaCallout && (
          <div className="bg-emerald-50 rounded-2xl border-2 border-emerald-200 p-6 md:p-8 mb-6">
            <h2 className="text-lg font-bold text-emerald-900 mb-3">
              {RESULT_STRINGS.malaysiaCalloutTitle}
            </h2>
            <p className="text-sm text-emerald-900 leading-relaxed">
              {RESULT_STRINGS.malaysiaCalloutBody}
            </p>
          </div>
        )}

        {/* Category breakdown */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-6">
          <h2 className="text-lg font-bold text-[#1E3A5F] mb-4">
            {RESULT_STRINGS.categoryBreakdown}
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
                      {meta.name}
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
              <Lock size={18} /> {RESULT_STRINGS.hardStopsTitle}
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
              <AlertTriangle size={18} /> {RESULT_STRINGS.riskFlagsTitle}
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

        {/* 5-gate check (Fix 5: server-sorted array) */}
        {data.gateResults && data.gateResults.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-6">
            <h2 className="text-lg font-bold text-[#1E3A5F] mb-4">
              {RESULT_STRINGS.fiveGateTitle}
            </h2>
            <ul className="space-y-1.5">
              {data.gateResults.map((g) => (
                <li key={g.gateNumber} className="flex items-center gap-2 text-sm">
                  {g.passed
                    ? <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
                    : <XCircle size={14} className="text-red-600 flex-shrink-0" />}
                  <span className="text-[#1E3A5F]">{g.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Full answer log */}
        {data.answers && Object.keys(data.answers).length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-6">
            <button
              type="button"
              onClick={() => setOpenAnswerLog((o) => !o)}
              className="text-sm font-semibold text-[#1E3A5F] hover:text-[#E8B923] inline-flex items-center gap-1"
            >
              {openAnswerLog ? '▾' : '▸'} {RESULT_STRINGS.fullAnswerLog}
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
            title={RESULT_STRINGS.pdfComingSoon}
          >
            <Download size={14} /> {RESULT_STRINGS.downloadPdfCta}
          </button>
          <Link
            href="/student/dashboard"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#E8B923]"
          >
            {RESULT_STRINGS.backToDashboard} <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
