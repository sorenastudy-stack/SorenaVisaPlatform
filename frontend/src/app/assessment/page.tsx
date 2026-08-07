'use client';

// PR-PHASE33 — redesigned (v2) assessment. NEW ROUTE — the live /scorecard form
// is untouched; this does not go live until the AI foundation + Recommendation
// Explanation Agent are ready and Yashua flips the switch.
//
// Flow: 31-question form (byte-identical scored keys) → on submit, score-preview
// (eligibility + band) AND matching recommendations (ranked, with whyThisFits) →
// a single results screen. Q32's field options are restricted by the Q30 rule
// using the SERVER-AUTHORITATIVE allowed set (never diverges from the matcher).

import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSESSMENT_V2, type V2FieldDef } from '@/lib/scorecard/v2/assessment-v2';
import { buildScoringAnswers } from '@/lib/scorecard/v2/scoring-answers';
import { buildMatchCriteria } from '@/lib/scorecard/v2/match-criteria';
import { saveDraft, loadDraft, clearDraft, hasAnswers } from '@/lib/scorecard/v2/assessment-draft';
import {
  DECLARATION_STEP, TOTAL_STEPS, STEP_TITLES,
  validateStep, validateAll, clampStep, type FieldErrors,
} from '@/lib/scorecard/v2/assessment-steps';
import { CountrySelect } from '@/components/common/CountrySelect';
import { PhoneInput } from '@/components/common/PhoneInput';
import { FormProgress } from '@/components/common/FormProgress';

// Demo-only override: when NEXT_PUBLIC_ASSESSMENT_LIVE=true (set ONLY on the demo
// Railway env), this assessment IS the live funnel for the presentation, so the
// "preview build — not yet live" notices are suppressed. Prod never sets the flag,
// so the banners remain and the production go-live gate (Phase 33) is unchanged.
const ASSESSMENT_LIVE = process.env.NEXT_PUBLIC_ASSESSMENT_LIVE === 'true';

interface StudyFieldOpt {
  id: string; key: string; nameEn: string; nameFa: string;
  category: { key: string; nameEn: string; alwaysSelectable: boolean };
}
interface WhyDim { dim: string; verdict: string; detail: string }
interface Rec {
  programmeId: string; programmeName: string; providerName: string; level: string;
  city?: string | null; tuitionFeeNZD?: number | null; currency?: string;
  rankingTier?: string | null; descriptionEn?: string | null;
  scholarships: { name: string }[]; fitScore: number; whyThisFits: WhyDim[];
}
interface Preview {
  totalScore: number; band: string; bandName: string; bandRange: string;
  executionEligible: boolean; hardStops: { code: string; name: string; resolution: string }[];
  riskFlags: string[];
}

type Answers = Record<string, string | string[] | boolean | number>;

export default function AssessmentV2Page() {
  const [answers, setAnswers] = useState<Answers>({});
  const [fields, setFields] = useState<StudyFieldOpt[]>([]);
  const [allowed, setAllowed] = useState<Set<string> | null>(null);
  const [phase, setPhase] = useState<'form' | 'submitting' | 'result'>('form');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ── step state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  // The furthest step reached, which is what the progress dots may jump to.
  // Tracked separately from `step` so going Back does not lock the way forward.
  const [maxVisited, setMaxVisited] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [declarationChecked, setDeclarationChecked] = useState(false);

  // The array check is not paranoia. `.catch()` only covers a network or parse
  // failure; an endpoint that answers with an error OBJECT resolves happily,
  // `fields` stops being an array, and the `fields.find(...)` in render throws —
  // white-screening the whole public form with no message. Found by opening the
  // page in a browser with the backend down; no test caught it, because every
  // test mocks this endpoint into returning an array.
  useEffect(() => {
    fetch('/api/assessment/study-fields')
      .then((r) => r.json())
      .then((data) => setFields(Array.isArray(data) ? data : []))
      .catch(() => setFields([]));
  }, []);

  // ── session-scoped autosave ───────────────────────────────────────────────
  // Restore runs exactly once, BEFORE the save effect is allowed to write.
  // Ordering matters under React StrictMode, which double-invokes effects in
  // development: a save effect that ran first would persist the empty initial
  // state and destroy the very draft we are about to restore. (Same failure
  // that ate the Explore page's "what changed" timestamp.)
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const draft = loadDraft();
    if (draft && hasAnswers(draft.answers)) {
      setAnswers(draft.answers as Answers);
      // Restoring the answers but dropping the applicant back at step 1 would
      // be worse than not restoring at all — they would have to click through
      // seven steps of answers they can already see.
      const resumed = clampStep(draft.step);
      setStep(resumed);
      setMaxVisited(resumed);
    }
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    if (!hasAnswers(answers)) return;
    const id = setTimeout(() => saveDraft(answers, step), 500);
    return () => clearTimeout(id);
  }, [answers, step]);

  // Changing step writes immediately, bypassing the 500 ms debounce above.
  // Answer → Next → refresh is fast enough to beat the timer, and losing the
  // answer that triggered the navigation is the worst possible thing to lose.
  const goToStep = (next: number) => {
    const target = clampStep(next);
    setStep(target);
    setMaxVisited((m) => Math.max(m, target));
    setErrors({});
    if (hasAnswers(answers)) saveDraft(answers, target);
    window.scrollTo(0, 0);
  };

  // Q32 restriction — refetch the server-authoritative allowed set when Q13 changes.
  const q13 = answers.q13_qualification_field as string | undefined;
  useEffect(() => {
    if (!q13) { setAllowed(null); return; }
    fetch(`/api/assessment/allowed-fields?qualificationFieldId=${encodeURIComponent(q13)}`)
      .then((r) => r.json())
      // Same hazard as study-fields above: `new Set(someObject)` throws
      // "is not iterable" rather than producing an empty set.
      .then((ids: unknown) => setAllowed(Array.isArray(ids) ? new Set(ids as string[]) : null))
      .catch(() => setAllowed(null));
  }, [q13]);

  const set = (k: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [k]: v }));

  const allowedFields = useMemo(
    () => (allowed ? fields.filter((f) => allowed.has(f.id)) : []),
    [allowed, fields],
  );

  const visible = (f: V2FieldDef) => !f.visibleWhen || f.visibleWhen(answers as Record<string, unknown>);

  const isDeclarationStep = step === DECLARATION_STEP;
  const section = isDeclarationStep ? null : ASSESSMENT_V2[step];

  // A tick on the progress bar means "this step has all its answers", not
  // "you have been here". Recomputed from the answers so it stays honest when a
  // later answer reveals a required field on a step already passed.
  const completedSteps = useMemo(
    () => [
      ...ASSESSMENT_V2.map((_, i) => Object.keys(validateStep(i, answers)).length === 0),
      declarationChecked,
    ],
    [answers, declarationChecked],
  );

  // Next is gated on THIS step only. Back never is — a wrong answer must never
  // trap someone on a step they want to leave.
  function onNext() {
    setError(null);
    const stepErrors = validateStep(step, answers);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      setError('Please complete the highlighted answers before continuing.');
      return;
    }
    goToStep(step + 1);
  }

  function onBack() {
    setError(null);
    goToStep(step - 1);
  }

  async function onSubmit() {
    setError(null);

    // Per-step gating is necessary but NOT sufficient. Visibility is computed
    // from the whole answer set, so an answer given later can reveal a required
    // field on a step already passed. Ten fields here are conditional.
    const { errors: allErrors, firstBadStep } = validateAll(answers);
    if (firstBadStep !== null) {
      setErrors(allErrors);
      setStep(firstBadStep);
      setMaxVisited((m) => Math.max(m, firstBadStep));
      setError('Some earlier answers are still missing — we have taken you back to them.');
      window.scrollTo(0, 0);
      return;
    }

    setPhase('submitting');
    try {
      // `fields` is passed so the StudyField ids the picker emits can be
      // resolved to the keys the scoring maps use. Without it every lookup
      // missed and every applicant silently scored 'Other' for field.
      const scoringAnswers = buildScoringAnswers(answers, fields);
      const criteria = buildMatchCriteria(answers);
      const [prevRes, recRes] = await Promise.all([
        fetch('/api/assessment/score-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: scoringAnswers }) }),
        fetch('/api/assessment/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(criteria) }),
      ]);
      setPreview(await prevRes.json());
      setRecs(await recRes.json());
      // Submitted successfully — the draft has served its purpose. Left behind,
      // "Start over" in the same tab would hand back the answers just sent.
      clearDraft();
      setPhase('result');
      window.scrollTo(0, 0);
    } catch {
      setError('Something went wrong. Please try again.');
      setPhase('form');
    }
  }

  if (phase === 'result' && preview) {
    // "Start over" clears the answers too — with the draft already gone, leaving
    // them in state would immediately re-save a draft of the form just submitted.
    return <ResultView preview={preview} recs={recs} onRestart={() => {
      setAnswers({}); clearDraft();
      setStep(0); setMaxVisited(0); setErrors({}); setDeclarationChecked(false);
      setPhase('form'); setPreview(null); setRecs([]);
    }} />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {!ASSESSMENT_LIVE && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Preview build — this redesigned assessment is not yet live. The current assessment is unchanged.
        </div>
      )}
      <h1 className="text-2xl font-bold text-[#1e3a5f]">Readiness assessment</h1>
      <p className="mt-1 text-sm text-gray-500">A short assessment that scores your profile and recommends specific study options.</p>

      <div className="mt-6">
        <FormProgress
          current={step}
          total={TOTAL_STEPS}
          maxVisited={maxVisited}
          titles={STEP_TITLES}
          completed={completedSteps}
          onJump={goToStep}
        />
      </div>

      {section ? (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#c9a961]">{section.title}</h2>
          <div className="mt-3 space-y-5">
            {section.questions
              .filter((q) => !q.visibleWhen || q.visibleWhen(answers as Record<string, unknown>))
              .map((q) => (
                <div key={q.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-semibold text-[#1e3a5f]">{q.heading}</p>
                  <div className="mt-3 space-y-3">
                    {q.fields.filter(visible).map((f) => (
                      <Field key={f.key} f={f} value={answers[f.key]} onChange={(v) => set(f.key, v)}
                        error={errors[f.key]}
                        hideLabel={q.fields.length === 1 && f.label === q.heading}
                        studyFields={fields} allowedFields={allowedFields} allowedReady={allowed !== null} q13Label={fields.find((x) => x.id === q13)?.nameEn} />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ) : (
        <DeclarationStep checked={declarationChecked} onChange={setDeclarationChecked} />
      )}

      {error && <p className="mt-4 text-sm text-red-600" role="alert">{error}</p>}

      <div className="mt-8 flex items-center justify-between gap-3">
        {step > 0 ? (
          <button type="button" onClick={onBack} disabled={phase === 'submitting'}
            className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-[#1e3a5f] hover:bg-gray-50 disabled:opacity-50">
            Back
          </button>
        ) : <span />}

        {isDeclarationStep ? (
          <button type="button" onClick={onSubmit} disabled={!declarationChecked || phase === 'submitting'}
            className="rounded-xl bg-[#1e3a5f] px-6 py-3 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:cursor-not-allowed disabled:opacity-50">
            {phase === 'submitting' ? 'Scoring…' : 'See my result & recommendations'}
          </button>
        ) : (
          <button type="button" onClick={onNext}
            className="rounded-xl bg-[#1e3a5f] px-6 py-3 text-sm font-semibold text-white hover:bg-[#162d4a]">
            Next
          </button>
        )}
      </div>
    </div>
  );
}

interface FieldProps {
  f: V2FieldDef; value: Answers[string]; onChange: (v: Answers[string]) => void;
  studyFields: StudyFieldOpt[]; allowedFields: StudyFieldOpt[]; allowedReady: boolean; q13Label?: string;
  /**
   * Hide the field's own label, for a single-field question whose label is
   * word-for-word the card heading above it ("Full name" / "Full name"). It is
   * hidden, never dropped: the control still needs an accessible name.
   */
  hideLabel?: boolean;
}

/**
 * Renders the control plus its own validation message.
 *
 * The error sits under the field it belongs to, not in a single line above the
 * form. With 55 required fields the old single-message approach told the
 * applicant one problem at a time and did not say where it was.
 */
function Field({ error, ...props }: FieldProps & { error?: string }) {
  return (
    <div>
      <FieldControl {...props} />
      {error && (
        <p className="mt-1 text-xs text-red-600" role="alert" data-testid={`error-${props.f.key}`}>
          {error}
        </p>
      )}
    </div>
  );
}

function FieldControl({ f, value, onChange, studyFields, allowedFields, allowedReady, q13Label, hideLabel }: FieldProps) {
  const base = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm';
  const labelCls = hideLabel ? 'sr-only' : 'text-xs text-gray-600';
  if (f.type === 'select') {
    return (
      <label className="block">
        <span className={labelCls}>{f.label}</span>
        <select className={base} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select —</option>
          {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {f.helper && <span className="mt-1 block text-[11px] text-gray-400">{f.helper}</span>}
      </label>
    );
  }
  if (f.type === 'studyfield') {
    return (
      <label className="block">
        <span className={labelCls}>{f.label}</span>
        <select className={base} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select —</option>
          {studyFields.map((sf) => <option key={sf.id} value={sf.id}>{sf.nameEn}</option>)}
        </select>
        {f.helper && <span className="mt-1 block text-[11px] text-gray-400">{f.helper}</span>}
      </label>
    );
  }
  if (f.type === 'studyfield-multi') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    return (
      <div>
        <span className={labelCls}>{f.label}</span>
        {!allowedReady ? (
          <p className="mt-1 text-[11px] text-gray-400">Answer &ldquo;Field of your highest qualification&rdquo; first to see your options.</p>
        ) : (
          <>
            <p className="mt-1 mb-2 text-[11px] text-gray-400">
              Based on your qualification{q13Label ? ` in ${q13Label}` : ''}, you can choose from these related fields — plus Business &amp; Management, open to all backgrounds.
            </p>
            <div className="flex flex-wrap gap-2">
              {allowedFields.map((sf) => (
                <button key={sf.id} type="button" onClick={() => toggle(sf.id)}
                  className={['rounded-full border px-3 py-1 text-xs', selected.includes(sf.id) ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white' : 'border-gray-300 text-[#1e3a5f]'].join(' ')}>
                  {sf.nameEn}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
  if (f.type === 'boolean') {
    return (
      <div>
        <span className={labelCls}>{f.label}</span>
        <div className="mt-1 flex gap-2">
          {[['Yes', true], ['No', false]].map(([lbl, val]) => (
            <button key={String(val)} type="button" onClick={() => onChange(val as boolean)}
              className={['rounded-lg border px-4 py-1.5 text-sm', value === val ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white' : 'border-gray-300 text-[#1e3a5f]'].join(' ')}>{lbl}</button>
          ))}
        </div>
      </div>
    );
  }
  // PR-COUNTRY-PHONE — country and phone are never free text anywhere on the
  // platform. Both were plain inputs here; the country one asked the applicant
  // to know their own ISO 3166 code ("ISO code, e.g. IR").
  // Both pickers render their own interactive element rather than an <input>,
  // so the label is attached with htmlFor/id. Wrapping them in a bare <label>
  // as the plain inputs below do would give the control no accessible name.
  if (f.type === 'country') {
    return (
      <div>
        <label htmlFor={f.key} className={labelCls}>{f.label}</label>
        <div className="mt-1">
          <CountrySelect
            id={f.key}
            value={(value as string) || null}
            onChange={(code) => onChange(code ?? '')}
          />
        </div>
        {f.helper && <span className="mt-1 block text-[11px] text-gray-400">{f.helper}</span>}
      </div>
    );
  }
  if (f.type === 'phone') {
    return (
      <div>
        <label htmlFor={f.key} className={labelCls}>{f.label}</label>
        <div className="mt-1">
          <PhoneInput id={f.key} value={(value as string) ?? ''} onChange={onChange} />
        </div>
        {f.helper && <span className="mt-1 block text-[11px] text-gray-400">{f.helper}</span>}
      </div>
    );
  }

  // text / email / number
  return (
    <label className="block">
      <span className={labelCls}>{f.label}</span>
      <input className={base} type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : 'text'}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(f.type === 'number' ? Number(e.target.value) : e.target.value)} />
      {f.helper && <span className="mt-1 block text-[11px] text-gray-400">{f.helper}</span>}
    </label>
  );
}

/**
 * Final step — the applicant confirms their answers before they are scored.
 *
 * Mirrors the live /scorecard's declaration step. It is a consent gate, not a
 * question: nothing here is stored or scored, and Submit stays disabled until
 * the box is ticked.
 */
function DeclarationStep({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-wide text-[#c9a961]">Declaration</h2>
      <div className="mt-3 rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm font-semibold text-[#1e3a5f]">Before we score your profile</p>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Your result and the programmes we recommend are based entirely on the answers you have
          given. Inaccurate answers produce an inaccurate assessment, and any application built on
          them may later be refused.
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#1e3a5f]"
          />
          <span className="text-sm text-[#1e3a5f]">
            I confirm the information I have given is true and complete to the best of my knowledge.
          </span>
        </label>
      </div>
    </section>
  );
}

function ResultView({ preview, recs, onRestart }: { preview: Preview; recs: Rec[]; onRestart: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {!ASSESSMENT_LIVE && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">Preview build — not live.</div>
      )}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-gray-500">Your readiness</p>
        <p className="mt-1 text-3xl font-extrabold text-[#1e3a5f]">{preview.totalScore} <span className="text-lg text-gray-400">/ 100</span></p>
        <p className="mt-1 text-sm font-semibold text-[#1e3a5f]">{preview.band.replace('BAND_', 'Band ')} — {preview.bandName}</p>
        <p className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${preview.executionEligible ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
          {preview.executionEligible ? 'Execution eligible' : 'Not yet eligible'}
        </p>
        {preview.hardStops.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-bold text-red-800">Blockers</p>
            {preview.hardStops.map((h) => <p key={h.code} className="mt-1 text-xs text-red-800">{h.name} — {h.resolution}</p>)}
          </div>
        )}
      </div>

      <h2 className="mt-8 text-lg font-bold text-[#1e3a5f]">Recommended for you</h2>
      {recs.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No matching programmes yet — your case advisor will help identify options.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {recs.map((r) => (
            <div key={r.programmeId} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[#1e3a5f]">{r.programmeName}</p>
                  <p className="text-xs text-gray-500">{r.providerName}{r.city ? ` · ${r.city}` : ''}{r.rankingTier ? ` · ${r.rankingTier}` : ''}</p>
                </div>
                {r.tuitionFeeNZD != null && <span className="shrink-0 text-xs font-semibold text-[#1e3a5f]">NZD {r.tuitionFeeNZD.toLocaleString('en-NZ')}</span>}
              </div>
              {r.scholarships.length > 0 && (
                <p className="mt-1 text-xs font-medium text-emerald-700">Scholarship: {r.scholarships.map((s) => s.name).join(', ')}</p>
              )}
              <ul className="mt-2 space-y-0.5">
                {r.whyThisFits.map((w, i) => <li key={i} className="text-xs text-gray-600">• {w.detail}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      <button onClick={onRestart} className="mt-8 text-sm font-medium text-[#1e3a5f] underline">Start over</button>
    </div>
  );
}
