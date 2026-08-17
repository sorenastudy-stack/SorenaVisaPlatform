'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoneyCents, formatMoney } from '@/lib/money';

// PR-RECS-PHASE1 — "others you might also consider", under the student's own
// programme choices in Apply/Study Step 1.
//
// READ-ONLY BY CONSTRUCTION. There is no add-to-list action here and no write of
// any kind: a suggestion is something to look at, not a commitment.
// AdmissionProgrammeChoice remains the only thing that books a slot.
//
// SHOWN ONLY AFTER THE STUDENT HAS CHOSEN. The component is rendered by Step 1
// only when at least one choice exists, and independently the endpoint returns
// nothing until then — so the student's own decision is always made first and
// uninfluenced. Two locks on purpose: the UI condition is convenience, the
// server one is the guarantee.
//
// The "why" lines are the existing deterministic whyThisFits dimensions rendered
// verbatim. Nothing here writes prose, and nothing calls a model.

// The real shape emitted by whyThisFits(), confirmed against a live response:
//   { dim: 'field', detail: 'Open to your background.', verdict: 'aligns' }
// Typed to that rather than guessed — an earlier draft read `label`/`dimension`,
// which do not exist, and would have rendered the detail with no heading.
interface WhyDimension { dim?: string; detail?: string; verdict?: string }
const DIM_LABEL: Record<string, string> = {
  field: 'Field', level: 'Level', budget: 'Budget', location: 'Location', institution: 'Institution',
};
interface Suggestion {
  id: string; programmeId: string; programmeName: string; providerName: string;
  city: string | null; level: string; tuitionFeeNZD: number | null; currency: string;
  durationMonths: number | null; durationText: string | null;
  why: WhyDimension[] | null; fitScore: number; rank: number;
}
interface Payload { available: boolean; reason: string; items: Suggestion[]; suggestionCount: number }

export function SuggestedProgrammes({ choiceCount }: { choiceCount: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // Re-fetch when the choice list changes: a programme just chosen should stop
    // being suggested back to the student.
    setLoading(true);
    api.get<Payload>('/student/recommendations/for-admission')
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [choiceCount]);

  // Silent when there is nothing useful to say. This block is an extra, and an
  // empty "no suggestions" panel would just be noise beside the real task.
  if (loading || !data?.available || data.items.length === 0) return null;

  return (
    <div className="mt-8 rounded-2xl border border-dashed border-[#c9a961]/50 bg-[#faf8f3] p-5">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={16} className="text-[#b28f4e]" />
        <h3 className="text-sm font-bold text-[#1e3a5f]">Others you might also consider</h3>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-[#4A4A4A]/70">
        Based on your assessment. These are suggestions only — your choices above are what count,
        and nothing here is added unless you add it yourself.
      </p>

      <ul className="space-y-3">
        {data.items.map((s) => (
          <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1e3a5f]">{s.programmeName}</p>
                <p className="mt-0.5 text-xs text-[#4A4A4A]/70">
                  {s.providerName}{s.city ? ` · ${s.city}` : ''}
                  {s.durationText ? ` · ${s.durationText}` : ''}
                </p>
              </div>
              {s.tuitionFeeNZD != null && (
                <p className="shrink-0 text-sm font-semibold text-[#1e3a5f]">
                  {formatMoney(s.tuitionFeeNZD, s.currency || 'NZD')}
                </p>
              )}
            </div>

            {/* The deterministic breakdown, rendered as-is. */}
            {Array.isArray(s.why) && s.why.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.why.slice(0, 4).map((w, i) => {
                  if (!w.detail) return null;
                  const label = w.dim ? (DIM_LABEL[w.dim] ?? w.dim) : null;
                  return (
                    <span
                      key={i}
                      className="rounded-full bg-[#1e3a5f]/5 px-2.5 py-1 text-[11px] font-medium text-[#1e3a5f]"
                    >
                      {label ? `${label}: ${w.detail}` : w.detail}
                    </span>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
