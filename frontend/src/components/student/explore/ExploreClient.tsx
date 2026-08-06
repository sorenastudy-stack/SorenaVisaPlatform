'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Loader2, MapPin, Search, Star, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-EXPLORE — student programme browser.
//
// LAYOUT: results list on the LEFT, map on the RIGHT (Owner's call). On mobile
// the two stack with the list first, because the list is the thing you read and
// the map is the thing you glance at.
//
// Leaflet touches `window` on import, so the map is loaded client-side only.
const ExploreMap = dynamic(
  () => import('./ExploreMap').then((m) => m.ExploreMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center rounded-xl bg-gray-50 text-sm text-gray-400">
        <Loader2 size={16} className="mr-2 animate-spin" /> Loading map…
      </div>
    ),
  },
);

interface Result {
  id: string; name: string; level: string; nzqfLevel: string;
  qualificationType: string | null; majorStrand: string | null; subjectArea: string | null;
  campusCity: string | null; durationText: string | null; coverImageUrl: string | null;
  provider: { id: string; name: string; isFeatured: boolean; city: string | null; latitude: number | null; longitude: number | null };
  pricing: {
    tuitionNZD: number | null; tuitionSource: string; tuitionRaw: string | null; tuitionNote: string | null;
    scholarshipNZD: number; netCostNZD: number | null;
  };
}

interface Payload {
  nationality: string | null;
  nationalityKnown: boolean;
  total: number;
  sort: string;
  results: Result[];
  map: {
    pins: Array<{ providerId: string; providerName: string; isFeatured: boolean; latitude: number; longitude: number; programmeCount: number; fromNetCostNZD: number | null }>;
    unmapped: Array<{ providerId: string; providerName: string; programmeCount: number }>;
  };
}

const SORTS: Array<{ value: string; label: string }> = [
  { value: 'featured', label: 'Recommended' },
  { value: 'lowestNetCost', label: 'Lowest total cost' },
  { value: 'lowestTuition', label: 'Lowest tuition' },
  { value: 'highestScholarship', label: 'Biggest scholarship' },
];

const money = (n: number | null) => (n == null ? null : `NZ$${n.toLocaleString()}`);

export function ExploreClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState('featured');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ sort });
    if (debounced.trim()) params.set('search', debounced.trim());
    setError(null);
    api.get<Payload>(`/explore?${params}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Could not load programmes.'); });
    return () => { cancelled = true; };
  }, [sort, debounced]);

  // Clicking a pin filters the list to that institution — the map and the list
  // are two views of one selection, not two separate tools.
  const visible = useMemo(() => {
    if (!data) return [];
    return selectedProviderId
      ? data.results.filter((r) => r.provider.id === selectedProviderId)
      : data.results;
  }, [data, selectedProviderId]);

  const selectedName = selectedProviderId
    ? data?.results.find((r) => r.provider.id === selectedProviderId)?.provider.name
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">Explore programmes</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every programme open to you, with the fees and scholarships that apply to your nationality.
        </p>
      </div>

      {/* Pricing is nationality-scoped; if we don't know it, say so rather than
          quoting a figure that may not be the student's rate. */}
      {data && !data.nationalityKnown && (
        <div className="mb-4 flex gap-2 rounded-lg border border-[#c9a961] bg-[#fff8e1] p-3 text-sm text-[#7a6320]">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p>We don’t have your nationality on file yet, so the fees below are the standard published rates. Add it to your profile to see the fees and scholarships that apply to you.</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-[#1e3a5f] focus:outline-none"
            placeholder="Search by programme, subject or institution…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#1e3a5f] focus:outline-none"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {selectedProviderId && (
        <button
          type="button"
          onClick={() => setSelectedProviderId(null)}
          className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#1e3a5f]/10 px-3 py-1 text-xs font-semibold text-[#1e3a5f]"
        >
          <MapPin size={13} /> {selectedName} — showing only this institution · clear
        </button>
      )}

      {error && <Card><CardContent className="p-5 text-sm text-red-600">{error}</CardContent></Card>}

      {!data && !error && (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" /> Loading programmes…
        </div>
      )}

      {data && (
        <>
          {/* LIST LEFT · MAP RIGHT. On mobile they stack, list first. */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="order-1 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {visible.length} programme{visible.length === 1 ? '' : 's'}
                {data.total !== visible.length && ` of ${data.total}`}
              </p>

              {visible.length === 0 && (
                <Card><CardContent className="p-5 text-sm text-gray-500">
                  No programmes match that search yet.
                </CardContent></Card>
              )}

              {visible.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => router.push(`/student/explore/${r.id}`)}
                  onMouseEnter={() => setSelectedProviderId((cur) => cur ?? null)}
                  className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left transition-all hover:border-[#1e3a5f]/40 hover:shadow-sm"
                >
                  <div className="flex gap-3">
                    {/* Ranking number — the list is ordered, and saying so makes
                        the sort control's effect obvious. */}
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1e3a5f]/8 text-xs font-bold text-[#1e3a5f]">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold leading-snug text-[#1e3a5f]">{r.name}</h3>
                        {r.provider.isFeatured && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#c9a961]/15 px-2 py-0.5 text-[10px] font-bold text-[#8a6d10]">
                            <Star size={10} /> Featured
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-600">{r.provider.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-400">
                        {[r.qualificationType, r.nzqfLevel?.replace('LEVEL_', 'Level '), r.campusCity, r.durationText]
                          .filter(Boolean).join(' · ')}
                      </p>

                      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        {r.pricing.netCostNZD != null ? (
                          <span className="text-sm font-bold text-[#1e3a5f]">
                            {money(r.pricing.netCostNZD)}
                            <span className="ml-1 text-[10px] font-medium text-gray-400">your cost / year</span>
                          </span>
                        ) : (
                          <span className="text-xs italic text-gray-400">
                            {r.pricing.tuitionRaw ?? 'fee not published as a single figure'}
                          </span>
                        )}
                        {r.pricing.scholarshipNZD > 0 && (
                          <span className="rounded-full bg-[#15a86b]/10 px-2 py-0.5 text-[11px] font-semibold text-[#15a86b]">
                            −{money(r.pricing.scholarshipNZD)} scholarship
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}

              {/* Institutions with no coordinate are listed, never dropped. */}
              {data.map.unmapped.length > 0 && !selectedProviderId && (
                <p className="pt-1 text-[11px] text-gray-400">
                  {data.map.unmapped.length} institution{data.map.unmapped.length === 1 ? '' : 's'} in these results
                  {data.map.unmapped.length === 1 ? ' has' : ' have'} no map location yet —
                  {' '}{data.map.unmapped.map((u) => u.providerName).join(', ')}.
                </p>
              )}
            </div>

            <div className="order-2 h-[420px] lg:sticky lg:top-6 lg:h-[calc(100vh-8rem)]">
              <ExploreMap
                pins={data.map.pins}
                selectedProviderId={selectedProviderId}
                onSelectProvider={setSelectedProviderId}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
