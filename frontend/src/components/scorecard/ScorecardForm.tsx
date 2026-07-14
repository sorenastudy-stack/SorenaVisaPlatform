'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, AlertCircle, Save } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { FORM_SECTIONS, FORM_UI } from '@/lib/scorecard/labels';
import {
  ALL_QUESTIONS, FORM_SCHEMA, getQuestionLabel, isQuestionVisible, QuestionDef,
} from '@/lib/scorecard/questions';
import { fillHiddenAnswers } from '@/lib/scorecard/submit-helpers';
import { LanguageSelect } from '@/components/scorecard/LanguageSelect';
import { localeToLanguageCode } from '@/lib/languages';
import { useLocaleStore } from '@/lib/stores/localeStore';

// PR-SCORECARD-2 — Multi-step scorecard form.
//
// 5 sections (contact + 4 scoring categories) + 1 final declaration
// step. Autosave fires on "Save & next" (POST /scorecard/draft).
// Conditional questions are hidden when their predicate fails and
// don't block section progression.
//
// Fix 9 (PR-SCORECARD-2 follow-up): scorecard pages render in English
// only. The platform-wide locale toggle still works elsewhere; the
// scorecard surface ignores it. `dir` is always 'ltr' here.
//
// Fix 6: `fillHiddenAnswers` runs immediately before submit so the
// scoring engine receives canonical fallbacks for skipped fields.
// Without this, the engine would lose +2 pts each on Q5/Q7/Q9/Q10/Q11
// and +3 pts on Q8 for users who skip them.
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

// Path A: anonymous visitors have no server draft (that endpoint is
// auth-gated), so their in-progress answers are persisted client-side here.
const ANON_DRAFT_KEY = 'sorena_scorecard_draft';

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

export function ScorecardForm({
  initialDraft,
  isAuthenticated,
}: {
  initialDraft: InitialDraft | null;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);

  // Phase 2b: pre-select the first language from the site locale (Farsi site →
  // 'fa'), but only when the user hasn't already got one from a resumed draft.
  // Purely a default — the field stays optional and the user can change it.
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    // Authenticated → server draft; anonymous → localStorage draft.
    let seed: Record<string, string> = { ...(initialDraft?.answers ?? {}) };
    if (!isAuthenticated && typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(ANON_DRAFT_KEY);
        if (raw) seed = { ...(JSON.parse(raw) as Record<string, string>) };
      } catch { /* localStorage unavailable / bad JSON — start fresh */ }
    }
    if (!seed.first_language) seed.first_language = localeToLanguageCode(locale);
    return seed;
  });
  // Path A: shown after an EXISTING-account submit (magic-link emailed).
  const [existingEmailSent, setExistingEmailSent] = useState(false);
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
        errs[q.id] = FORM_UI.fieldRequired;
        continue;
      }
      if (q.type === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        errs[q.id] = FORM_UI.invalidEmail;
        continue;
      }
      if (q.type === 'phone' && v && !v.startsWith('+')) {
        errs[q.id] = FORM_UI.invalidPhone;
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
      // Drafts only carry currently-visible answers. Hidden conditional
      // fallbacks land at submit time (see fillHiddenAnswers below).
      const cleaned: Record<string, string> = {};
      for (const q of ALL_QUESTIONS) {
        const v = answers[q.id];
        if (v !== undefined && v !== '' && isQuestionVisible(q, answers)) {
          cleaned[q.id] = v;
        }
      }
      if (!isAuthenticated) {
        // Anonymous — persist client-side only; the server draft route is
        // auth-gated and must stay that way (no cross-user reads).
        try { window.localStorage.setItem(ANON_DRAFT_KEY, JSON.stringify(cleaned)); } catch { /* ignore */ }
        setSaving(false);
        return true;
      }
      await api.post('/scorecard/draft', { answers: cleaned });
      setSaving(false);
      return true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : FORM_UI.saveErrorBanner;
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

    // 1. Strip hidden visible answers (form-validation-clean snapshot).
    const visibleOnly: Record<string, string> = {};
    for (const q of ALL_QUESTIONS) {
      const v = answers[q.id];
      if (v !== undefined && v !== '' && isQuestionVisible(q, answers)) {
        visibleOnly[q.id] = v;
      }
    }
    // 2. Fix 6: backfill canonical "Not applicable" / "0" / "No test
    //    taken" values for the hidden conditional fields so the
    //    scoring engine sees a complete answer set.
    const cleaned = fillHiddenAnswers(visibleOnly);

    const attribution = readAttribution();
    try {
      if (isAuthenticated) {
        // Returning signed-in client — existing authed path.
        await api.post('/scorecard/submit', { answers: cleaned, attribution });
        router.push('/scorecard/result');
        return;
      }
      // Anonymous — submit via the same-origin Next route, which creates the
      // LEAD server-side and sets sorena_session for NEW accounts. Response:
      //   • mode 'new'      → session cookie set → go to the result page.
      //   • mode 'existing' → a magic-link was emailed → show check-your-email.
      const res = await fetch('/api/scorecard/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: cleaned, attribution }),
      });
      const data = (await res.json().catch(() => ({}))) as { mode?: string; message?: string };
      if (!res.ok) throw new Error(data?.message || 'Submission failed. Please try again.');
      try { window.localStorage.removeItem(ANON_DRAFT_KEY); } catch { /* ignore */ }
      if (data.mode === 'existing') {
        setExistingEmailSent(true);
        setSubmitting(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      // mode 'new' — the cookie is now set; land on the result page signed in.
      router.push('/scorecard/result');
    } catch (err) {
      const msg = err instanceof ApiError || err instanceof Error
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

  // Path A: existing-account submit → a magic-link was emailed. Generic copy
  // that reveals nothing about whether the account is a client or staff.
  if (existingEmailSent) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <h2 className="text-xl font-bold text-[#1E3A5F] mb-2">Check your email</h2>
          <p className="text-sm text-[#4A4A4A] leading-relaxed">
            Thanks — your assessment has been received. We&apos;ve emailed you a secure link to
            view your result. Open it on this device to continue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-sm font-semibold text-[#1E3A5F] mb-2">
          <span>
            {FORM_UI.progressLabel
              .replace('{current}', String(currentStep + 1))
              .replace('{total}',   String(TOTAL_SECTIONS))}
          </span>
          {saving && (
            <span className="inline-flex items-center gap-1 text-xs text-[#4A4A4A]/70 font-medium">
              <Loader2 size={12} className="animate-spin" /> {FORM_UI.saving}
            </span>
          )}
        </div>
        <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-[#F3CE49] transition-all"
            style={{ width: `${((currentStep + 1) / TOTAL_SECTIONS) * 100}%` }}
          />
        </div>
      </div>

      {showResumeBanner && (
        <div className="mb-6 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <Save size={16} /> {FORM_UI.resumeBanner}
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
                {sectionMeta.title}
              </h2>
              {sectionMeta.maxPoints > 0 && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1E3A5F] text-white">
                  {sectionMeta.maxPoints} pts
                </span>
              )}
            </div>
            <p className="text-sm text-[#4A4A4A]/70">{sectionMeta.description}</p>
          </div>

          {currentSection && (
            <div className="space-y-5">
              {currentSection.questions.map((q) => {
                if (!isQuestionVisible(q, answers)) return null;
                return (
                  <FieldRow
                    key={q.id}
                    q={q}
                    label={getQuestionLabel(q, answers)}
                    value={answers[q.id] ?? ''}
                    error={errors[q.id]}
                    onChange={(v) => updateAnswer(q.id, v)}
                  />
                );
              })}

              {skippedNotice !== null && (
                <div className="text-xs text-[#4A4A4A]/60 italic pt-2 border-t border-gray-100">
                  {FORM_UI.conditionalSkip}
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
            {FORM_UI.declarationTitle}
          </h2>
          <p className="text-sm text-[#4A4A4A] leading-relaxed mb-5">
            {FORM_UI.declarationBody}
          </p>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={declarationChecked}
              onChange={(e) => setDeclarationChecked(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 accent-[#1E3A5F]"
            />
            <span className="text-sm font-semibold text-[#1E3A5F]">
              {FORM_UI.declarationAgree}
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
            <ArrowLeft size={14} />
            {FORM_UI.previous}
          </button>
        ) : <span />}

        {isDeclarationStep ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!declarationChecked || submitting}
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-xl bg-[#F3CE49] text-[#1E3A5F] font-bold text-sm hover:bg-[#d4a91f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? FORM_UI.submitting : FORM_UI.submit}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="inline-flex items-center gap-1 px-6 py-3 rounded-xl bg-[#1E3A5F] text-white font-semibold text-sm hover:bg-[#162d49] disabled:opacity-50 transition-colors"
          >
            {FORM_UI.next}
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  q, label, value, error, onChange,
}: {
  q: QuestionDef;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  const inputClasses = [
    'w-full px-3 py-2.5 rounded-xl border bg-white text-[#1E3A5F]',
    'focus:outline-none focus:ring-2 focus:ring-[#F3CE49]/40',
    error
      ? 'border-red-300 focus:border-red-400'
      : 'border-gray-200 focus:border-[#1E3A5F]',
  ].join(' ');

  return (
    <div>
      <label className="block text-sm font-semibold text-[#1E3A5F] mb-1.5">
        {label}
        {q.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {q.helper && (
        <p className="text-xs text-[#4A4A4A]/60 mb-1.5 -mt-0.5">{q.helper}</p>
      )}

      {q.type === 'language' ? (
        <LanguageSelect value={value} onChange={onChange} className={inputClasses} />
      ) : q.type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        >
          <option value="">— select —</option>
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
