'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Award, AlertTriangle, CheckCircle2, XCircle, Calendar, CreditCard,
  Sparkles, BookOpen, Lock, ArrowRight, Download, ExternalLink, Scale,
} from 'lucide-react';
import { api } from '@/lib/api';
import { BAND_META, CATEGORY_META, RESULT_STRINGS } from '@/lib/scorecard/labels';
import {
  FALLBACK_BOOKING_URLS,
  getBookingUrls,
  type BookingUrls,
} from '@/lib/scorecard/booking-urls';
import { downloadPdf } from '@/lib/scorecard/pdf-download';
import type { ScorecardResultPayload } from '@/app/scorecard/result/page';

// CTA matrix — band/hard-stop → button(s) + "why this matters" copy.
// Hard-stop override (this polish PR): any hard stop, ANY band, gets
// the LIA button. This goes beyond Strategic Session v4.0 Table 12
// (which baselined Bands 1-2 as nurture-only) because legal
// complexity must be reviewed by the LIA before nurture content
// makes sense.
//
//   Scenario   Band     Hard stop?   Button(s)
//   A          1-2      no           — (nurture only, no buttons)
//   B          3        no           Gap-Closing (NZD 30)
//   C          3        yes          LIA Consultation (NZD 150)
//   D          4-6      no           Free 15-min
//   E          4-6      yes          LIA primary + Free 15-min secondary
//   F          1-2      yes          LIA Consultation (NZD 150)  ← override

const WHY_GAP_CLOSING =
  'Your assessment shows real potential, but specific areas need closing before you’re ready for application. This 30-minute session with our Admission Specialist gives you a structured improvement plan tailored to your profile and answers your immediate questions.';

const WHY_LIA_BAND_3 =
  'Your profile shows legal complexity that must be reviewed by our Licensed Immigration Adviser before we can proceed. This 30-minute session resolves the blocking issue so the rest of your plan can move forward.';

const WHY_FREE_15MIN =
  'You qualify to start your application journey. This free 15-minute session with our team confirms your pathway, walks you through next steps, and is required before opening your case file.';

const WHY_LIA_HIGH_BAND =
  'Your assessment shows you’re ready overall — but a specific legal issue must be cleared first by our Licensed Immigration Adviser. This 30-minute session resolves the blocking item so you can move forward to the free 15-minute session below.';

const WHY_LIA_LOW_BAND =
  'Your assessment shows specific issues that must be reviewed by our Licensed Immigration Adviser before we can recommend any next step. This 30-minute legal session resolves the blocking item — without it, no further pathway can be planned.';

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
  const router = useRouter();
  const [openAnswerLog, setOpenAnswerLog] = useState(false);
  const [bookingClicked, setBookingClicked] = useState(!!data.consultationBookedAt);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // PR-SCORECARD-4: booking URLs are OWNER-editable. Start with the
  // hard-coded fallback (matches the migration seed) so the buttons
  // are always usable, then upgrade to the OWNER's edited values
  // once the GET /scorecard/booking-urls fetch resolves. getBookingUrls()
  // already swallows network errors and resolves to the fallback,
  // so there's no error branch to render.
  const [bookingUrls, setBookingUrls] = useState<BookingUrls>(FALLBACK_BOOKING_URLS);

  useEffect(() => {
    let cancelled = false;
    getBookingUrls().then((urls) => {
      if (!cancelled) setBookingUrls(urls);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bandMeta = BAND_META[data.band];
  const colorClasses = BAND_COLOR_CLASSES[bandMeta?.color ?? 'gray'];
  const applicantName = data.answers?.full_name ?? '';
  const generatedDate = new Date(data.submittedAt).toLocaleDateString('en-NZ', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Derive routing from band + hard-stop state. Hard-stop override
  // applies regardless of band — even Bands 1 and 2 — because legal
  // complexity must be reviewed by the LIA before any nurture or
  // session content makes sense.
  const hasHardStop = data.hardStops.length > 0;
  const isLowBand   = data.band === 'BAND_1' || data.band === 'BAND_2';
  const isBand3     = data.band === 'BAND_3';
  const isHighBand  = data.band === 'BAND_4' || data.band === 'BAND_5' || data.band === 'BAND_6';

  let scenario: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  if (hasHardStop && isLowBand)        scenario = 'F'; // override: LIA only
  else if (hasHardStop && isBand3)     scenario = 'C'; // LIA replaces gap-closing
  else if (hasHardStop && isHighBand)  scenario = 'E'; // LIA + free 15-min
  else if (isLowBand)                  scenario = 'A'; // nurture only
  else if (isBand3)                    scenario = 'B'; // gap-closing
  else                                 scenario = 'D'; // free 15-min

  // Shared booking handler: all booking now lives INSIDE the client
  // portal. Each CTA maps to a booking "type" that the portal
  // placeholder page reads from the query string. We still fire the
  // booking-opened audit POST so tracking is unchanged, then navigate
  // in-app to /portal/booking — no external Wix URLs (which 404).
  //
  // The external booking-urls.ts machinery + GET /scorecard/booking-urls
  // endpoint are intentionally left in place (unused for navigation)
  // in case we repurpose them later.
  async function handleBookingNavigate(type: 'free15' | 'gap' | 'lia') {
    setBookingError(null);
    try {
      await api.post(`/scorecard/${data.submissionId}/booking-opened`, {});
      setBookingClicked(true);
    } catch {
      setBookingError(RESULT_STRINGS.bookingError);
    }
    // Navigate regardless of audit outcome — getting the user into the
    // portal matters more than the tracking row.
    router.push(`/portal/booking?type=${type}`);
  }

  return (
    <div className="min-h-screen bg-[#FAF8F3] py-10 px-4">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 md:p-8 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Award size={24} className="text-[#b8941f]" />
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
        <div className="bg-white rounded-2xl shadow-md border-2 border-[#F3CE49]/50 p-6 md:p-8 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={18} className="text-[#b8941f]" />
            <h2 className="text-lg font-bold text-[#1E3A5F]">
              {RESULT_STRINGS.nextActionTitle}
            </h2>
          </div>
          {/* Polish PR: render structured content as a proper bulleted
              list when available; fall back to the flat string on
              legacy submissions. */}
          {data.nextActionContent ? (
            <div className="mb-4 max-w-[640px]">
              {data.nextActionContent.leadIn && (
                <p className="text-base text-[#4A4A4A] leading-relaxed mb-2">
                  {data.nextActionContent.leadIn}
                </p>
              )}
              <p className="text-base text-[#1E3A5F] font-semibold leading-relaxed mb-3">
                {data.nextActionContent.heading}
              </p>
              {data.nextActionContent.bullets.length > 0 && (
                <ul className="list-disc list-outside ml-6 space-y-1.5 text-[#4A4A4A] text-base leading-[1.6] marker:text-[#1E3A5F]">
                  {data.nextActionContent.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-base text-[#1E3A5F] font-semibold leading-relaxed mb-4">
              {data.nextActionTextEn}
            </p>
          )}

          {/* Scenario A — Bands 1-2 (any HS state): nurture only, no buttons */}
          {scenario === 'A' && (
            <div className="mt-4 pt-4 border-t border-[#F3CE49]/30">
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

          {/* Scenario B — Band 3, no hard stop: Gap-Closing Session */}
          {scenario === 'B' && (
            <div className="mt-4 pt-4 border-t border-[#F3CE49]/30">
              <WhyThisMatters text={WHY_GAP_CLOSING} />
              <PrimaryBookingButton
                icon={<CreditCard size={18} />}
                label="Pay NZD 30 and book your Gap-Closing Session"
                onClick={() => handleBookingNavigate('gap')}
              />
              <BookingFooter
                clicked={bookingClicked}
                error={bookingError}
                clickedText={RESULT_STRINGS.payGapRecorded}
              />
            </div>
          )}

          {/* Scenario C — Band 3 WITH hard stop: LIA replaces Gap-Closing */}
          {scenario === 'C' && (
            <div className="mt-4 pt-4 border-t border-[#F3CE49]/30">
              <WhyThisMatters text={WHY_LIA_BAND_3} />
              <LiaConsultationButton
                onClick={() => handleBookingNavigate('lia')}
              />
              <BookingFooter
                clicked={bookingClicked}
                error={bookingError}
                clickedText={RESULT_STRINGS.bookFreeRecorded}
              />
            </div>
          )}

          {/* Scenario D — Bands 4-6, no hard stop: Free 15-min */}
          {scenario === 'D' && (
            <div className="mt-4 pt-4 border-t border-[#F3CE49]/30">
              <WhyThisMatters text={WHY_FREE_15MIN} />
              <PrimaryBookingButton
                icon={<Calendar size={18} />}
                label="Book your free 15-minute consultation"
                onClick={() => handleBookingNavigate('free15')}
              />
              <BookingFooter
                clicked={bookingClicked}
                error={bookingError}
                clickedText={RESULT_STRINGS.bookFreeRecorded}
              />
            </div>
          )}

          {/* Scenario F — Bands 1-2 WITH hard stop: LIA only (override Table 12) */}
          {scenario === 'F' && (
            <div className="mt-4 pt-4 border-t border-[#F3CE49]/30">
              <WhyThisMatters text={WHY_LIA_LOW_BAND} />
              <LiaConsultationButton
                onClick={() => handleBookingNavigate('lia')}
              />
              <BookingFooter
                clicked={bookingClicked}
                error={bookingError}
                clickedText={RESULT_STRINGS.bookFreeRecorded}
              />
            </div>
          )}

          {/* Scenario E — Bands 4-6 WITH hard stop: LIA primary + Free 15-min secondary */}
          {scenario === 'E' && (
            <div className="mt-4 pt-4 border-t border-[#F3CE49]/30 space-y-6">
              <div>
                <WhyThisMatters text={WHY_LIA_HIGH_BAND} />
                <LiaConsultationButton
                  onClick={() => handleBookingNavigate('lia')}
                />
              </div>

              <div className="pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => handleBookingNavigate('free15')}
                  className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3 rounded-xl bg-gray-100 text-[#1E3A5F]/70 font-semibold text-sm hover:bg-gray-200 transition-colors"
                >
                  <Calendar size={14} />
                  Book your free 15-minute consultation
                  <ExternalLink size={12} />
                </button>
                <p className="mt-2 text-xs text-[#4A4A4A]/60 italic leading-relaxed">
                  Available after your LIA consultation clears the blocking item.
                </p>
              </div>

              <BookingFooter
                clicked={bookingClicked}
                error={bookingError}
                clickedText={RESULT_STRINGS.bookFreeRecorded}
              />
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
                    <div className="h-full bg-[#F3CE49]" style={{ width: `${pct}%` }} />
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
              className="text-sm font-semibold text-[#1E3A5F] hover:text-[#b8941f] inline-flex items-center gap-1"
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
          <PdfDownloadButton
            submissionId={data.submissionId}
            applicantName={applicantName}
          />
          <Link
            href="/student/dashboard"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#1E3A5F] hover:text-[#b8941f]"
          >
            {RESULT_STRINGS.backToDashboard} <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Booking-CTA sub-components ──────────────────────────────────────

function WhyThisMatters({ text }: { text: string }) {
  return (
    <p className="text-sm italic text-gray-600 leading-relaxed mb-3 max-w-[600px]">
      {text}
    </p>
  );
}

function PrimaryBookingButton({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ minHeight: 56 }}
      className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-4 rounded-xl bg-[#F3CE49] text-[#1E3A5F] font-bold text-base hover:bg-[#d4a91f] transition-colors shadow-md"
    >
      {icon}
      {label} →
      <ExternalLink size={14} />
    </button>
  );
}

function LiaConsultationButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ minHeight: 56 }}
      className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-4 rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-900 font-bold text-base hover:bg-amber-100 transition-colors shadow-md"
    >
      <Scale size={18} />
      Book your LIA Consultation (NZD 150) →
      <ExternalLink size={14} />
    </button>
  );
}

function BookingFooter({
  clicked, error, clickedText,
}: { clicked: boolean; error: string | null; clickedText: string }) {
  return (
    <>
      {clicked && (
        <p className="mt-3 text-sm text-emerald-700 inline-flex items-center gap-1">
          <CheckCircle2 size={14} /> {clickedText}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}
    </>
  );
}

// PR-SCORECARD-3: real client-facing PDF download. PDFKit generates
// the file server-side (typically 5-15 KB, 4-5 pages). The button
// flips to a spinner during fetch and surfaces an inline error
// banner if generation fails.
function PdfDownloadButton({
  submissionId, applicantName,
}: { submissionId: string; applicantName: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fallback = `sorena-assessment-${(applicantName || 'applicant')
    .split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'applicant'}-${yyyymmdd}.pdf`;
  async function onClick() {
    setErr(null);
    setBusy(true);
    try {
      await downloadPdf(`/scorecard/${submissionId}/pdf`, fallback);
    } catch (e: any) {
      setErr('Could not generate PDF. Please try again or contact your case advisor.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl border-2 border-[#1E3A5F] text-[#1E3A5F] text-sm font-bold hover:bg-[#1E3A5F]/5 transition-colors disabled:opacity-50"
      >
        <Download size={14} />
        {busy ? 'Preparing PDF…' : 'Download your report (PDF) →'}
      </button>
      {err && (
        <span className="text-xs text-red-700">{err}</span>
      )}
    </div>
  );
}
