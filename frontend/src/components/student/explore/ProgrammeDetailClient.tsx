'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, Star, MapPin, Clock, GraduationCap, Info, Sparkles, PlayCircle, ExternalLink,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';

// PR-EXPLORE — one programme, in full.
//
// Three payloads, deliberately separate requests:
//   detail   — renders the page; everything below waits on nothing else
//   changes  — "what changed since you last looked", from the audit trail
//   videos   — an AI call + YouTube corpus; slow and fallible, so it must never
//              be able to hold up or break the page
//
// The last-viewed timestamp lives in localStorage. It is a per-device nicety,
// not a security boundary: the backend gates the programme itself, and `since`
// only decides how much history is shown.
const LAST_VIEWED_KEY = 'sorena.explore.lastViewed';

interface Detail {
  id: string; name: string; level: string; nzqfLevel: string;
  qualificationType: string | null; majorStrand: string | null; subjectArea: string | null;
  campusCity: string | null; durationText: string | null; durationMonths: number | null;
  deliveryMode: string | null; coverImageUrl: string | null; descriptionEn: string | null;
  programmeUrl: string | null;
  academicPrerequisites: string | null; englishRequirement: string | null; otherRequirements: string | null;
  scholarshipNote: string | null;
  intakes: { remaining2026: string | null; published2027: string | null; projected2027: string | null; basis2027: string | null; months: number[] };
  provider: { id: string; name: string; brand: string | null; isFeatured: boolean; city: string | null; websiteUrl: string | null; latitude: number | null; longitude: number | null };
  pricing: {
    nationality: string | null; nationalityKnown: boolean;
    tuition: { amountNZD: number | null; source: string; feeYear: number | null; note: string | null };
    tuitionRaw: string | null; tuitionNote: string | null;
    scholarship: { totalNZD: number; lines: Array<{ id: string; name: string; amountNZD: number; amountType: string; rawValue: number }>; unresolved: Array<{ name: string; reason: string }> };
    netCostNZD: number | null;
  };
  studyFields: string[];
}

interface ChangeItem { at: string; field: string | null; label: string; from: any; to: any }
interface VideoPayload { source: 'manual' | 'matched'; available: boolean; videos: Array<{ videoId: string; url: string; title: string | null; reason: string | null }> }

const money = (n: number | null | undefined) => (n == null ? null : `NZ$${Number(n).toLocaleString()}`);

export function ProgrammeDetailClient({ programmeId }: { programmeId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeItem[] | null>(null);
  const [videos, setVideos] = useState<VideoPayload | null>(null);
  const [videosLoading, setVideosLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get<Detail>(`/explore/programmes/${programmeId}`)
      .then((r) => { if (!cancelled) setD(r); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Could not load this programme.'); });

    // What changed since this device last opened THIS programme.
    //
    // READ ONLY here. The new timestamp is written AFTER the response arrives,
    // never before: this effect runs twice under React StrictMode in
    // development (and again on any remount or fast refresh), and an
    // immediate write meant the second run read the timestamp the first run
    // had just set — so `since` became "a moment ago", the answer was always
    // "nothing changed", and the panel could never appear. Advancing
    // last-viewed only once the changes have actually been fetched is also the
    // honest order of events.
    let since: string | null = null;
    try {
      since = JSON.parse(localStorage.getItem(LAST_VIEWED_KEY) ?? '{}')[programmeId] ?? null;
    } catch { /* private mode / storage disabled — just show no history */ }

    api.get<{ changes: ChangeItem[] }>(`/explore/programmes/${programmeId}/changes${since ? `?since=${encodeURIComponent(since)}` : ''}`)
      .then((r) => {
        if (cancelled) return;
        setChanges(r.changes);
        try {
          const store = JSON.parse(localStorage.getItem(LAST_VIEWED_KEY) ?? '{}');
          store[programmeId] = new Date().toISOString();
          localStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(store));
        } catch { /* nothing to do — the panel just shows the same list next time */ }
      })
      .catch(() => { if (!cancelled) setChanges([]); }); // never block the page

    api.get<VideoPayload>(`/explore/programmes/${programmeId}/videos`)
      .then((r) => { if (!cancelled) setVideos(r); })
      .catch(() => { if (!cancelled) setVideos({ source: 'matched', available: false, videos: [] }); })
      .finally(() => { if (!cancelled) setVideosLoading(false); });

    return () => { cancelled = true; };
  }, [programmeId]);

  if (error) {
    return <div className="mx-auto max-w-4xl p-6"><Card><CardContent className="p-5 text-sm text-red-600">{error}</CardContent></Card></div>;
  }
  if (!d) {
    return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading programme…</div>;
  }

  const p = d.pricing;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <button type="button" onClick={() => router.push('/student/explore')}
        className="mb-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#1e3a5f]">
        <ArrowLeft size={15} /> Back to all programmes
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-[#1e3a5f]">{d.name}</h1>
          <p className="mt-1 text-sm text-gray-600">{d.provider.name}</p>
        </div>
        {d.provider.isFeatured && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#c9a961]/15 px-2.5 py-1 text-[11px] font-bold text-[#8a6d10]">
            <Star size={11} /> Featured institution
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        {d.qualificationType && <span className="inline-flex items-center gap-1"><GraduationCap size={13} /> {d.qualificationType}</span>}
        {d.nzqfLevel && <span>{d.nzqfLevel.replace('LEVEL_', 'NZQF Level ')}</span>}
        {d.campusCity && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {d.campusCity}</span>}
        {d.durationText && <span className="inline-flex items-center gap-1"><Clock size={13} /> {d.durationText}</span>}
      </div>

      {/* ── what changed since last visit ─────────────────────────────────── */}
      {changes && changes.length > 0 && (
        <Card className="mt-5 border-[#c9a961]">
          <CardContent className="p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[#8a6d10]">
              <Sparkles size={14} /> What changed since you last looked
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
              {changes.map((c, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="font-semibold text-[#1e3a5f]">{c.label}</span>
                  {c.field && (
                    <span className="text-gray-500">
                      {c.from != null && c.from !== '' ? <span className="line-through">{String(c.from)}</span> : <em>not set</em>}
                      {' → '}
                      <span className="font-medium text-gray-800">{c.to != null && c.to !== '' ? String(c.to) : 'not set'}</span>
                    </span>
                  )}
                  <span className="text-[11px] text-gray-400">{new Date(c.at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── cost breakdown ────────────────────────────────────────────────── */}
      <Card className="mt-5">
        <CardContent className="p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">What this costs you</h2>

          {!p.nationalityKnown && (
            <div className="mt-2 flex gap-2 rounded-lg bg-[#fff8e1] p-2.5 text-xs text-[#7a6320]">
              <Info size={14} className="mt-0.5 shrink-0" />
              <p>These are the standard published rates. Add your nationality to your profile to see the fees and scholarships that apply to you.</p>
            </div>
          )}

          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-gray-600">
                Tuition{p.tuition.feeYear ? ` (${p.tuition.feeYear})` : ''}
                {p.tuition.source === 'NATIONALITY_SPECIFIC' && (
                  <span className="ml-1.5 rounded bg-[#1e3a5f]/8 px-1.5 py-0.5 text-[10px] font-semibold text-[#1e3a5f]">your nationality</span>
                )}
              </span>
              {p.tuition.amountNZD != null
                ? <span className="font-semibold text-[#1e3a5f]">{money(p.tuition.amountNZD)}</span>
                : <span className="text-xs italic text-gray-400">not a single published figure</span>}
            </div>

            {/* The institution's own wording, kept verbatim when the fee could
                not be reduced to one number — never replaced by a guess. */}
            {p.tuition.amountNZD == null && (p.tuitionRaw || p.tuitionNote) && (
              <p className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">
                {p.tuitionRaw && <span className="italic">“{p.tuitionRaw}”</span>}
                {p.tuitionNote && <span className="mt-1 block text-gray-400">{p.tuitionNote}</span>}
              </p>
            )}

            {p.scholarship.lines.length > 0 && (
              <div className="border-t border-gray-100 pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Scholarships you qualify for</p>
                {p.scholarship.lines.map((s, i) => (
                  <div key={i} className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="text-gray-600">
                      {s.name}
                      {/* A percentage award shows the percent it came from, so
                          the arithmetic is checkable rather than asserted. */}
                      {s.amountType === 'PERCENTAGE' && (
                        <span className="ml-1 text-[11px] text-gray-400">({s.rawValue}% of tuition)</span>
                      )}
                    </span>
                    <span className="font-semibold text-[#15a86b]">−{money(s.amountNZD)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Scholarships that exist but could not be turned into a number are
                shown rather than hidden — a student should know they may be
                eligible for more than the total says. */}
            {p.scholarship.unresolved.length > 0 && (
              <div className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-500">
                <p className="font-semibold">Also possibly available, amount not confirmed:</p>
                {p.scholarship.unresolved.map((u, i) => <p key={i}>· {u.name} — {u.reason}</p>)}
              </div>
            )}

            <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2">
              <span className="font-semibold text-[#1e3a5f]">Your estimated cost</span>
              {p.netCostNZD != null
                ? <span className="text-lg font-bold text-[#1e3a5f]">{money(p.netCostNZD)}</span>
                : <span className="text-xs italic text-gray-400">not yet known</span>}
            </div>
            {p.scholarship.totalNZD > 0 && p.netCostNZD != null && (
              <p className="text-right text-xs text-[#15a86b]">after {money(p.scholarship.totalNZD)} in scholarships</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── entry requirements ────────────────────────────────────────────── */}
      {(d.academicPrerequisites || d.englishRequirement || d.otherRequirements) && (
        <Card className="mt-4">
          <CardContent className="space-y-3 p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">What you need to get in</h2>
            {d.academicPrerequisites && <Req label="Academic" value={d.academicPrerequisites} />}
            {d.englishRequirement && <Req label="English" value={d.englishRequirement} />}
            {d.otherRequirements && <Req label="Other" value={d.otherRequirements} />}
          </CardContent>
        </Card>
      )}

      {/* ── intakes ───────────────────────────────────────────────────────── */}
      {(d.intakes.remaining2026 || d.intakes.published2027 || d.intakes.projected2027) && (
        <Card className="mt-4">
          <CardContent className="space-y-2 p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">When you can start</h2>
            {d.intakes.remaining2026 && <Req label="Remaining 2026" value={d.intakes.remaining2026} />}
            {d.intakes.published2027 && <Req label="2027" value={d.intakes.published2027} />}
            {d.intakes.projected2027 && !d.intakes.published2027 && (
              <>
                <Req label="2027 (projected)" value={d.intakes.projected2027} />
                <p className="text-xs text-gray-400">
                  Projected by the institution — not yet confirmed{d.intakes.basis2027 ? ` (${d.intakes.basis2027})` : ''}.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── videos ────────────────────────────────────────────────────────── */}
      <Card className="mt-4">
        <CardContent className="p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-gray-500">
            <PlayCircle size={15} /> Watch
          </h2>
          {videosLoading && (
            <p className="mt-2 flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={13} className="animate-spin" /> Finding videos about this subject…
            </p>
          )}
          {!videosLoading && videos && videos.videos.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {videos.videos.map((v) => (
                <a key={v.videoId} href={v.url} target="_blank" rel="noopener noreferrer"
                  className="group rounded-lg border border-gray-200 p-2 transition-all hover:border-[#1e3a5f]/40 hover:shadow-sm">
                  <img
                    src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`}
                    alt="" className="aspect-video w-full rounded object-cover" loading="lazy"
                  />
                  <p className="mt-1.5 line-clamp-2 text-xs font-semibold text-[#1e3a5f]">{v.title ?? 'Watch on YouTube'}</p>
                  {v.reason && <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-400">{v.reason}</p>}
                </a>
              ))}
            </div>
          )}
          {/* A missing video strip is a missing extra, not an error. */}
          {!videosLoading && videos && videos.videos.length === 0 && (
            <p className="mt-2 text-xs text-gray-400">No videos matched to this programme yet.</p>
          )}
        </CardContent>
      </Card>

      {d.programmeUrl && (
        <a href={d.programmeUrl} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1e3a5f] hover:underline">
          View this programme on {d.provider.name}’s website <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

function Req({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="whitespace-pre-line text-sm text-gray-700">{value}</p>
    </div>
  );
}
