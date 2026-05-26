import Link from 'next/link';
import { UserSquare2, ArrowRight, Search, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { formatDate } from '../_utils/format';
import { AddOfficerButton } from './AddOfficerButton';

// PR-LIA-10 — Immigration Officer index page.
// Server component. Filters via URL search params; pagination is
// classical (page=N&pageSize=25). Sort toggles between "Most recent",
// "Most active", and "Name".

interface OfficerListItem {
  id: string;
  fullName: string;
  officerCode: string | null;
  branch: string | null;
  countryOfPosting: string | null;
  profileDescription: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  totalCases: number;
  approvedCases: number;
  declinedCases: number;
  pendingCases: number;
  observationCount: number;
  topCountries: string[];
  topCaseTypes: string[];
}

interface ListResponse {
  data: OfficerListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type SearchParams = {
  search?: string;
  branch?: string;
  countryOfPosting?: string;
  sort?: 'mostRecent' | 'mostActive' | 'name';
  page?: string;
};

export default async function OfficersIndexPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const sort = (['mostRecent', 'mostActive', 'name'] as const).includes(
    searchParams.sort as 'mostRecent' | 'mostActive' | 'name',
  )
    ? (searchParams.sort as 'mostRecent' | 'mostActive' | 'name')
    : 'mostRecent';

  const qs = new URLSearchParams();
  if (searchParams.search) qs.set('search', searchParams.search);
  if (searchParams.branch) qs.set('branch', searchParams.branch);
  if (searchParams.countryOfPosting) qs.set('countryOfPosting', searchParams.countryOfPosting);
  qs.set('sort', sort);
  qs.set('page', String(page));

  let result: ListResponse | null = null;
  let errorMsg: string | null = null;
  try {
    result = await apiServer.get<ListResponse>(`/officers?${qs.toString()}`);
  } catch (e) {
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load officers.';
  }

  const buildHref = (overrides: Partial<SearchParams>): string => {
    const merged: SearchParams = { ...searchParams, ...overrides };
    const next = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') next.set(k, String(v));
    });
    const s = next.toString();
    return s ? `/lia/officers?${s}` : '/lia/officers';
  };

  // Build filter-chip values from the current page's data so we don't
  // need a separate "distinct values" endpoint. This is approximate
  // (only shows what's on the current page) but useful in practice
  // for small officer rosters.
  const branchValues = new Set<string>();
  const countryValues = new Set<string>();
  result?.data.forEach((o) => {
    if (o.branch) branchValues.add(o.branch);
    if (o.countryOfPosting) countryValues.add(o.countryOfPosting);
  });

  return (
    <div className="max-w-7xl">
      <BackLink href="/lia" label="Back to dashboard" />

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <UserSquare2 size={22} className="text-[#E8B923]" />
            Immigration Officers
            <span className="text-sm font-medium text-[#4A4A4A]/60 ml-1">
              {result ? result.total : 0}
            </span>
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            Shared knowledge base of INZ officers. Profile data is collaborative; observations are attributed and append-only.
          </p>
        </div>
        <AddOfficerButton />
      </div>

      <Card className="mb-6">
        <CardContent>
          <form action="/lia/officers" method="get" className="space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A4A4A]/50" />
              <input
                name="search"
                type="search"
                defaultValue={searchParams.search ?? ''}
                placeholder="Search by name, branch, or country…"
                className="w-full min-h-[44px] pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F] outline-none"
              />
            </div>
            {/* preserve sort across form submit */}
            <input type="hidden" name="sort" value={sort} />
            {searchParams.branch && (
              <input type="hidden" name="branch" value={searchParams.branch} />
            )}
            {searchParams.countryOfPosting && (
              <input type="hidden" name="countryOfPosting" value={searchParams.countryOfPosting} />
            )}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3 mb-6">
        <ChipRow
          label="Sort"
          chips={[
            { label: 'Most recent', href: buildHref({ sort: 'mostRecent', page: '1' }), active: sort === 'mostRecent' },
            { label: 'Most active', href: buildHref({ sort: 'mostActive', page: '1' }), active: sort === 'mostActive' },
            { label: 'Name',        href: buildHref({ sort: 'name', page: '1' }),       active: sort === 'name' },
          ]}
        />
        {branchValues.size > 0 && (
          <ChipRow
            label="Branch"
            chips={[
              { label: 'All', href: buildHref({ branch: '', page: '1' }), active: !searchParams.branch },
              ...Array.from(branchValues).sort().map((b) => ({
                label: b,
                href: buildHref({ branch: b, page: '1' }),
                active: searchParams.branch === b,
              })),
            ]}
          />
        )}
        {countryValues.size > 0 && (
          <ChipRow
            label="Country"
            chips={[
              { label: 'All', href: buildHref({ countryOfPosting: '', page: '1' }), active: !searchParams.countryOfPosting },
              ...Array.from(countryValues).sort().map((c) => ({
                label: c,
                href: buildHref({ countryOfPosting: c, page: '1' }),
                active: searchParams.countryOfPosting === c,
              })),
            ]}
          />
        )}
      </div>

      {errorMsg && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg}</CardContent>
        </Card>
      )}

      {result && result.data.length === 0 && !errorMsg && (
        <Card>
          <CardContent className="py-12 text-center">
            <UserSquare2 size={32} className="mx-auto text-[#1E3A5F]/30 mb-3" />
            <p className="text-[#4A4A4A] font-medium">No officers match these filters</p>
            <p className="text-sm text-[#4A4A4A]/60 mt-1">Try clearing some filters, or add a new officer.</p>
          </CardContent>
        </Card>
      )}

      {result && result.data.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {result.data.map((o) => (
              <Link
                key={o.id}
                href={`/lia/officers/${o.id}`}
                className="block rounded-xl border border-gray-100 bg-white p-5 hover:shadow-md hover:border-[#E8B923] transition-all"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center flex-shrink-0">
                    <UserSquare2 size={18} className="text-[#1E3A5F]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-[#1E3A5F] truncate">{o.fullName}</h3>
                    <div className="text-xs text-[#4A4A4A]/70 mt-0.5 flex items-center gap-1 truncate">
                      <MapPin size={11} />
                      {o.branch ?? '—'}
                      {o.countryOfPosting && <span> · {o.countryOfPosting}</span>}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5 mb-3 text-center">
                  <Stat value={o.totalCases} label="Total" tone="navy" />
                  <Stat value={o.approvedCases} label="Approved" tone="emerald" />
                  <Stat value={o.declinedCases} label="Declined" tone="red" />
                  <Stat value={o.pendingCases} label="Pending" tone="gray" />
                </div>

                <div className="flex items-center justify-between text-xs text-[#4A4A4A]/60">
                  <span>{o.observationCount} observation{o.observationCount === 1 ? '' : 's'}</span>
                  <span className="text-[#1E3A5F] font-semibold inline-flex items-center gap-1 group-hover:text-[#E8B923]">
                    View profile <ArrowRight size={12} />
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {result.totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <div className="text-xs text-[#4A4A4A]/60">
                Page {result.page} of {result.totalPages} · {result.total} officer{result.total === 1 ? '' : 's'}
              </div>
              <div className="flex items-center gap-2">
                {page > 1 && (
                  <Link href={buildHref({ page: String(page - 1) })} className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-[#1E3A5F] hover:border-[#1E3A5F]">
                    ← Previous
                  </Link>
                )}
                {page < result.totalPages && (
                  <Link href={buildHref({ page: String(page + 1) })} className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-[#1E3A5F] hover:border-[#1E3A5F]">
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-[#4A4A4A]/50 mt-6">
        Last updated {result && result.data[0] ? formatDate(result.data[0].updatedAt) : '—'}
      </p>
    </div>
  );
}

function ChipRow({
  label,
  chips,
}: {
  label: string;
  chips: { label: string; href: string; active: boolean }[];
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-[#4A4A4A]/70 w-24 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {chips.map((c) => (
          <Link
            key={c.label + c.href}
            href={c.href}
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              c.active
                ? 'bg-[#1E3A5F] text-white'
                : 'bg-white text-[#4A4A4A] border border-gray-200 hover:border-[#1E3A5F] hover:text-[#1E3A5F]'
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: 'navy' | 'emerald' | 'red' | 'gray' }) {
  const tones = {
    navy: 'bg-[#1E3A5F]/5 text-[#1E3A5F]',
    emerald: 'bg-emerald-50 text-emerald-800',
    red: 'bg-red-50 text-red-800',
    gray: 'bg-gray-50 text-gray-700',
  };
  return (
    <div className={`rounded-lg px-1.5 py-1.5 ${tones[tone]}`}>
      <div className="text-base font-bold leading-none">{value}</div>
      <div className="text-[10px] font-semibold mt-0.5">{label}</div>
    </div>
  );
}
