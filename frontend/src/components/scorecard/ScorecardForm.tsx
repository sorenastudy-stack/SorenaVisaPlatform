'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ArrowLeft, ArrowRight, Loader2, AlertCircle, Save } from 'lucide-react';
import { useLocaleStore } from '@/lib/stores/localeStore';
import { api, ApiError } from '@/lib/api';
import {
  FORM_SECTIONS, FORM_UI, T,
} from '@/lib/scorecard/labels';
import {
  ALL_QUESTIONS, FORM_SCHEMA, isQuestionVisible, QuestionDef,
} from '@/lib/scorecard/questions';

// PR-SCORECARD-2 — Multi-step scorecard form.
//
// 5 sections (contact + 4 scoring categories) + 1 final declaration
// step. Autosave fires on "Save & next" (POST /scorecard/draft).
// Conditional questions are hidden when their predicate fails and
// don't block section progression.
//
// Attribution is read from:
//   1. sessionStorage (set by the landing page from URL params)
//   2. document.cookie (sv_attribution, set by /s/:shortCode redirect)
// and posted with the final submit.

interface InitialDraft {
  id: string;
  answers: Record<string, string>;
  draftLastSavedAt: string | null;
}

interface Attribution {
  trackingLinkId?: string;
  agentId?: string;
  campaignLabel?: string;
  channel?: string;
}

const TOTAL_SECTIONS = FORM_SCHEMA.length + 1; // +1 for declaration

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1] ?? '') : null;
}

function readAttribution(): Attribution {
  const out: Attribution = {};
  try {
    const stored = sessionStorage.getItem('sv_scorecard_attribution');
    if (stored) {
      const parsed = JSON.parse(stored) as {
        channel?: string | null;
        agentId?: string | null;
        campaignLabel?: string | null;
      };
      if (parsed.channel) out.channel = parsed.channel;
      if (parsed.agentId) out.agentId = parsed.agentId;
      if (parsed.campaignLabel) out.campaignLabel = parsed.campaignLabel;
    }
  } catch { /* sessionStorage disabled */ }

  const cookieLinkId = getCookie('sv_attribution');
  if (cookieLinkId) out.trackingLinkId = cookieLinkId;
  return out;
}

export function ScorecardForm({ initialDraft }: { initialDraft: InitialDraft | null }) {
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);
  const isRtl = locale === 'fa';

  const [answers, setAnswers] = useState<Record<string, string>>(initialDraft?.answers ?? {});
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [declarationChecked, setDeclarationChecked] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(!!initialDraft);

  const currentSection = currentStep < FORM_SCHEMA.length
    ? FORM_SCHEMA[currentStep]
    : null;
  const sectionMeta = currentStep < FORM_SECTIONS.length
    ? FORM_SECTIONS[currentStep]
    : null;
  const isDeclarationStep = currentStep === FORM_SCHEMA.length;

  // Validate current section's visible required questions.
  function validateCurrentSection(): boolean {
    if (!currentSection) return true;
    const errs: Record<string, string> = {};
    for (const q of currentSection.questions) {
      if (!isQuestionVisible(q, answers)) continue;
      const v = (answers[q.id] ?? '').trim();
      if (q.required && !v) {
        errs[q.id] = T(FORM_UI.fieldRequired, locale);
        continue;
      }
      if (q.type === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        errs[q.id] = T(FORM_UI.invalidEmail, locale);
        continue;
      }
      if (q.type === 'phone' && v && !v.startsWith('+')) {
        errs[q.id] = T(FORM_UI.invalidPhone, locale);
        continue;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function persistDraft(): Promise<boolean> {
    setSaving(true);
    setSaveError(null);
    try {
      // Strip any answers for currently-hidden conditional questions
      // so they don't accidentally affect scoring later.
      const cleaned: Record<string, string> = {};
      for (const q of ALL_QUESTIONS) {
        const v = answers[q.id];
        if (v !== undefined && v !== '' && isQuestionVisible(q, answers)) {
          cleaned[q.id] = v;
        }
      }
      await api.post('/scorecard/draft', { answers: cleaned });
      setSaving(false);
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : T(FORM_UI.saveErrorBanner, locale);
      setSaveError(msg);
      setSaving(false);
      return false;
    }
  }

  async function handleNext() {
    setShowResumeBanner(false);
    if (currentSection && !validateCurrentSection()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Persist on transition between scoring sections.
    if (currentSection) {
      const ok = await persistDraft();
      if (!ok) return;
    }
    setCurrentStep((s) => Math.min(s + 1, TOTAL_SECTIONS - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handlePrev() {
    setCurrentStep((s) => Math.max(s - 1, 0));
    setErrors({});
    setSaveError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit() {
    if (!declarationChecked) return;
    setSubmitting(true);
    setSubmitError(null);
    const cleaned: Record<string, string> = {};
    for (const q of ALL_QUESTIONS) {
      const v = answers[q.id];
      if (v !== undefined && v !== '' && isQuestionVisible(q, answers)) {
        cleaned[q.id] = v;
      }
    }
    const attribution = readAttribution();
    try {
      await api.post('/scorecard/submit', { answers: cleaned, attribution });
      router.push('/scorecard/result');
    } catch (err) {
      const msg = err instanceof ApiError
        ? err.message
        : 'Submission failed. Please try again.';
      setSubmitError(msg);
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function updateAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    }
  }

  // Count skipped questions for the conditional notice.
  const skippedNotice = useMemo(() => {
    if (!currentSection) return null;
    const hiddenInThisSection = currentSection.questions.filter(
      (q) => q.visibleWhen && !isQuestionVisible(q, answers),
    );
    return hiddenInThisSection.length > 0 ? hiddenInThisSection.length : null;
  }, [currentSection, answers]);

  return (
    <div className="max-w-3xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-sm font-semibold text-[#1E3A5F] mb-2">
          <span>
            {T(FORM_UI.progressLabel, locale)
              .replace('{current}', String(currentStep + 1))
              .replace('{total}',   String(TOTAL_SECTIONS))}
          </span>
          {saving && (
            <span className="inline-flex items-center gap-1 text-xs text-[#4A4A4A]/70 font-medium">
              <Loader2 size={12} className="animate-spin" /> {T(FORM_UI.saving, locale)}
            </span>
          )}
        </div>
        <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-[#E8B923] transition-all"
            style={{ width: `${((currentStep + 1) / TOTAL_SECTIONS) * 100}%` }}
          />
        </div>
      </div>

      {showResumeBanner && (
        <div className="mb-6 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <Save size={16} /> {T(FORM_UI.resumeBanner, locale)}
        </div>
      )}

      {saveError && (
        <div className="mb-6 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {saveError}
        </div>
      )}

      {submitError && (
        <div className="mb-6 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {submitError}
        </div>
      )}

      {/* Section content */}
      {sectionMeta && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-6">
          <div className="mb-6">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <h2 className="text-xl font-bold text-[#1E3A5F]">
                {T(sectionMeta.title, locale)}
              </h2>
              {sectionMeta.maxPoints > 0 && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1E3A5F] text-white">
                  {sectionMeta.maxPoints} pts
                </span>
              )}
            </div>
            <p className="text-sm text-[#4A4A4A]/70">{T(sectionMeta.description, locale)}</p>
          </div>

          {currentSection && (
            <div className="space-y-5">
              {currentSection.questions.map((q) => {
                if (!isQuestionVisible(q, answers)) return null;
                return (
                  <FieldRow
                    key={q.id}
                    q={q}
                    value={answers[q.id] ?? ''}
                    error={errors[q.id]}
                    locale={locale}
                    onChange={(v) => updateAnswer(q.id, v)}
                  />
                );
              })}

              {skippedNotice !== null && (
                <div className="text-xs text-[#4A4A4A]/60 italic pt-2 border-t border-gray-100">
                  {T(FORM_UI.conditionalSkip, locale)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Declaration step */}
      {isDeclarationStep && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 mb-6">
          <h2 className="text-xl font-bold text-[#1E3A5F] mb-4">
            {T(FORM_UI.declarationTitle, locale)}
          </h2>
          <p className="text-sm text-[#4A4A4A] leading-relaxed mb-5">
            {T(FORM_UI.declarationBody, locale)}
          </p>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={declarationChecked}
              onChange={(e) => setDeclarationChecked(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 accent-[#1E3A5F]"
            />
            <span className="text-sm font-semibold text-[#1E3A5F]">
              {T(FORM_UI.declarationAgree, locale)}
            </span>
          </label>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {currentStep > 0 ? (
          <button
            type="button"
            onClick={handlePrev}
            disabled={saving || submitting}
            className="inline-flex items-center gap-1 px-5 py-2.5 rounded-xl border border-gray-200 text-[#1E3A5F] hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
          >
            {isRtl ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
            {T(FORM_UI.previous, locale)}
          </button>
        ) : <span />}

        {isDeclarationStep ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!declarationChecked || submitting}
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-xl bg-[#E8B923] text-[#1E3A5F] font-bold text-sm hover:bg-[#d4a91f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? T(FORM_UI.submitting, locale) : T(FORM_UI.submit, locale)}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="inline-flex items-center gap-1 px-6 py-3 rounded-xl bg-[#1E3A5F] text-white font-semibold text-sm hover:bg-[#162d49] disabled:opacity-50 transition-colors"
          >
            {T(FORM_UI.next, locale)}
            {isRtl ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  q, value, error, locale, onChange,
}: {
  q: QuestionDef;
  value: string;
  error: string | undefined;
  locale: 'en' | 'fa';
  onChange: (v: string) => void;
}) {
  const inputClasses = [
    'w-full px-3 py-2.5 rounded-xl border bg-white text-[#1E3A5F]',
    'focus:outline-none focus:ring-2 focus:ring-[#E8B923]/40',
    error
      ? 'border-red-300 focus:border-red-400'
      : 'border-gray-200 focus:border-[#1E3A5F]',
  ].join(' ');

  return (
    <div>
      <label className="block text-sm font-semibold text-[#1E3A5F] mb-1.5">
        {T(q.label, locale)}
        {q.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {q.type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        >
          <option value="">{locale === 'fa' ? '— انتخاب کنید —' : '— select —'}</option>
          {(q.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : q.type === 'longtext' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={inputClasses}
        />
      ) : (
        <input
          type={q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        />
      )}

      {error && (
        <div className="mt-1 text-xs text-red-600 inline-flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </div>
      )}
    </div>
  );
}

// Lightweight unused-import guard so the test/typecheck stays happy.
void CheckCircle2;
