'use client';

import { Check, Loader2 } from 'lucide-react';

// PR-PHASE33-STEPS — step indicator for the multi-step assessment.
//
// Deliberately NOT shared with the live /scorecard, whose progress bar is ~20
// lines inlined in ScorecardForm.tsx. Extracting it would mean editing a form
// that is currently receiving real leads, to consolidate with a form that is
// meant to replace it — at which point /scorecard is deleted and the shared
// abstraction has one consumer again. Left alone on purpose.
//
// Navigation rule: only steps the user has ALREADY REACHED are clickable.
// Jumping ahead would skip the per-step validation gate, so `maxVisited` is the
// ceiling, not `total`.

export interface FormProgressProps {
  /** 0-based index of the step being shown. */
  current:  number;
  /** Total number of steps, INCLUDING the declaration step. */
  total:    number;
  /** Highest 0-based step index the user has reached. */
  maxVisited: number;
  /** Titles, one per step, for the tooltip and screen-reader label. */
  titles:   string[];
  /**
   * Per step: does it currently have every answer it needs?
   *
   * This is deliberately NOT "have you been here". A resumed session lands the
   * applicant on the step they left, which makes every earlier step "visited" —
   * ticking those would promise seven completed steps to someone who filled in
   * one, and then bounce them backwards on submit.
   */
  completed: boolean[];
  onJump:   (step: number) => void;
  /** Shows a "Saving…" hint next to the counter. */
  busy?:    boolean;
}

export function FormProgress({ current, total, maxVisited, titles, completed, onJump, busy = false }: FormProgressProps) {
  const pct = ((current + 1) / total) * 100;

  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center justify-between text-sm font-semibold text-[#1e3a5f]">
        <span>
          Step {current + 1} of {total}
          {titles[current] && <span className="ms-2 font-normal text-gray-500">· {titles[current]}</span>}
        </span>
        {busy && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
            <Loader2 size={12} className="animate-spin" /> Saving…
          </span>
        )}
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`Step ${current + 1} of ${total}`}
      >
        <div className="h-full bg-[#c9a961] transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Step dots. A reached step is a button; an unreached one is inert, so
          keyboard users cannot tab to a destination that would be refused. */}
      <ol className="mt-3 flex flex-wrap items-center gap-1.5">
        {titles.map((title, i) => {
          const reached = i <= maxVisited;
          const done    = reached && i !== current && completed[i] === true;
          const active  = i === current;

          const dot = (
            <span
              className={[
                'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-colors',
                active  ? 'bg-[#1e3a5f] text-white'
                : done    ? 'bg-[#c9a961] text-white'
                : reached ? 'bg-gray-200 text-[#1e3a5f]'
                :           'bg-gray-100 text-gray-300',
              ].join(' ')}
            >
              {done ? <Check size={12} /> : i + 1}
            </span>
          );

          return (
            <li key={i}>
              {reached ? (
                <button
                  type="button"
                  onClick={() => onJump(i)}
                  title={title}
                  aria-label={`Go to step ${i + 1}: ${title}`}
                  aria-current={active ? 'step' : undefined}
                  className="rounded-full focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/40"
                >
                  {dot}
                </button>
              ) : (
                <span title={title} aria-label={`Step ${i + 1}: ${title} (not yet reached)`} aria-disabled="true">
                  {dot}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default FormProgress;
