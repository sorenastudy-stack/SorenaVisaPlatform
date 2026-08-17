'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Clock3, Globe2 } from 'lucide-react';
import { api } from '@/lib/api';

// PR-PROVIDER-PORTAL — pricing by country group, for one programme.
//
// Tick a group, then give it a fee, a scholarship, or both — either alone is
// valid, which is why neither field is required and an untouched group simply
// has no override.
//
// Unticking does NOT delete: the row is deactivated server-side, so a price a
// student may already have been quoted stays on the record. The copy says
// "stop", not "remove", because that is what happens.
//
// On the ADD form there is no programme id yet, so this asks for the programme
// to be saved first rather than holding prices in memory and writing them into a
// second request that could fail on its own.

export interface GroupPriceRow {
  id: string;
  name: string;
  countryCount: number;
  tuition: { id: string; amount: number; reviewStatus: string; isActive: boolean } | null;
  scholarship: { id: string; name: string; amount: number; reviewStatus: string; isActive: boolean } | null;
}

/** The desired state this section wants saved, read by the parent on submit. */
export interface GroupPricingDraft {
  [groupId: string]: { on: boolean; tuition: string; scholarship: string };
}

export function ProgrammeGroupPricing({
  programmeId,
  draft,
  onDraftChange,
}: {
  programmeId: string | null;
  draft: GroupPricingDraft;
  onDraftChange: (d: GroupPricingDraft) => void;
}) {
  const [rows, setRows] = useState<GroupPriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!programmeId) { setRows([]); return; }
    api.get<{ groups: GroupPriceRow[] }>(`/provider/programmes/${programmeId}/group-pricing`)
      .then((r) => {
        setRows(r.groups);
        // Seed the draft from what is already stored, so an untouched save is a
        // no-op rather than a wipe.
        const seeded: GroupPricingDraft = {};
        for (const g of r.groups) {
          const tOn = g.tuition?.isActive ? String(g.tuition.amount) : '';
          const sOn = g.scholarship?.isActive ? String(g.scholarship.amount) : '';
          seeded[g.id] = { on: Boolean(tOn || sOn), tuition: tOn, scholarship: sOn };
        }
        onDraftChange(seeded);
      })
      .catch((e) => setError(e?.message ?? 'Couldn’t load your country groups.'));
    // onDraftChange is stable enough for this one-shot load; re-running on every
    // keystroke would fight the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programmeId]);
  useEffect(load, [load]);

  if (!programmeId) {
    return (
      <Section>
        <p className="text-xs text-gray-500">
          Save the programme first, then reopen it to set prices for a country group.
        </p>
      </Section>
    );
  }
  if (error) return <Section><p className="text-xs text-red-600">{error}</p></Section>;
  if (!rows) {
    return <Section><span className="inline-flex items-center gap-2 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading…</span></Section>;
  }
  if (rows.length === 0) {
    return (
      <Section>
        <p className="text-xs text-gray-500">
          You haven’t set up any country groups yet. Create one on the{' '}
          <strong className="text-[#1e3a5f]">Country groups</strong> tab, then come back here to price it.
        </p>
      </Section>
    );
  }

  const set = (id: string, patch: Partial<GroupPricingDraft[string]>) =>
    onDraftChange({ ...draft, [id]: { ...(draft[id] ?? { on: false, tuition: '', scholarship: '' }), ...patch } });

  const anyPending = rows.some(
    (g) => (g.tuition?.isActive && g.tuition.reviewStatus !== 'APPROVED')
      || (g.scholarship?.isActive && g.scholarship.reviewStatus !== 'APPROVED'),
  );

  return (
    <Section>
      <p className="text-xs leading-relaxed text-gray-600">
        Charge some countries a different fee for this programme. Leave a group unticked to use the
        programme’s standard fee.
      </p>
      {anyPending && (
        <p className="flex items-start gap-2 rounded-lg border border-[#c9a961]/40 bg-[#faf8f3] px-3 py-2 text-xs text-gray-700">
          <Clock3 size={13} className="mt-0.5 shrink-0 text-[#8a6d10]" />
          Some of these are with our team for review and won’t show to students until that’s done.
        </p>
      )}

      <div className="space-y-2">
        {rows.map((g) => {
          const d = draft[g.id] ?? { on: false, tuition: '', scholarship: '' };
          const wasPriced = Boolean(g.tuition || g.scholarship);
          return (
            <div key={g.id} className="rounded-xl border border-gray-200 p-3">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={d.on}
                  onChange={(e) => set(g.id, { on: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 accent-[#1e3a5f]"
                />
                <span className="flex-1 text-sm font-semibold text-sorena-navy">{g.name}</span>
                <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                  <Globe2 size={12} /> {g.countryCount}
                </span>
              </label>

              {d.on && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Money
                    label="Tuition fee (NZD)"
                    value={d.tuition}
                    onChange={(v) => set(g.id, { tuition: v })}
                    status={g.tuition?.isActive ? g.tuition.reviewStatus : null}
                  />
                  <Money
                    label="Scholarship (NZD)"
                    value={d.scholarship}
                    onChange={(v) => set(g.id, { scholarship: v })}
                    status={g.scholarship?.isActive ? g.scholarship.reviewStatus : null}
                  />
                </div>
              )}

              {!d.on && wasPriced && (
                <p className="mt-2 text-xs text-[#8a6d10]">
                  Saving will stop this group’s pricing for this programme. We keep the record — nothing is deleted.
                </p>
              )}
              {d.on && !d.tuition && !d.scholarship && (
                <p className="mt-2 text-xs text-gray-500">
                  Fill in a fee, a scholarship, or both — otherwise this group uses the standard fee.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Money({
  label, value, onChange, status,
}: { label: string; value: string; onChange: (v: string) => void; status: string | null }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
        {status && status !== 'APPROVED' && <Clock3 size={11} className="text-[#8a6d10]" />}
      </span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        placeholder="—"
        className="min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm text-sorena-navy focus:border-[#1e3a5f] focus:outline-none"
      />
    </label>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-[#faf8f3]/40 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Pricing by country group</h3>
      {children}
    </div>
  );
}
