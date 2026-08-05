// PR-EXPLORE — pure link + precedence logic for the programme detail page's
// "Related videos" block. NO DB, NO I/O, NO AI. Mirrors programme-choice-rules.logic.ts.
//
// TWO FROZEN PRODUCT RULES (Owner, confirmed):
//
// 1. OUTBOUND LINKS ONLY — never an embedded iframe player. Clicking a video must
//    send the student to youtube.com so the play counts as real watch time on the
//    Sorena Visa channel. buildWatchUrl() therefore emits a canonical
//    https://www.youtube.com/watch?v=<id> URL, and linkAttributes() pins
//    target=_blank + rel="noopener noreferrer" so the student keeps their place
//    on the platform and the new tab cannot reach back via window.opener.
//
// 2. MANUAL OVERRIDE WINS. When staff have set manualVideoIds on a programme,
//    those are the videos — the AI matches are discarded entirely, not merged.
//    Staff correcting a bad match must not have the agent's picks reappear
//    alongside their choice.

/** Canonical YouTube watch URL. Never an /embed/ URL — see rule 1. */
export function buildWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** Anchor attributes for every video card. Fixed by rule 1 — not caller-configurable. */
export function linkAttributes(): { target: string; rel: string } {
  return { target: '_blank', rel: 'noopener noreferrer' };
}

/**
 * A YouTube video id is 11 chars of [A-Za-z0-9_-]. Validate before building a URL
 * so a malformed id from a spreadsheet or a bad AI response can't produce a broken
 * or attacker-controlled link.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(id: unknown): id is string {
  return typeof id === 'string' && VIDEO_ID.test(id);
}

/**
 * Accepts what staff realistically paste: a bare id, a watch URL, a youtu.be
 * short link, a Shorts URL, or an embed URL — and normalises to a bare id.
 * Returns null when nothing usable is present (caller flags it, never guesses).
 */
export function extractVideoId(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  // Plain regex, not isValidVideoId(): that is an `id is string` type guard, and on
  // an already-string value it narrows the else-branch to `never`.
  if (VIDEO_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return isValidVideoId(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (isValidVideoId(v)) return v;
    // /shorts/<id>, /embed/<id>, /live/<id>
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

export type VideoSource = 'MANUAL' | 'AI_MATCHED';

export interface VideoCard {
  videoId: string;
  title: string;
  watchUrl: string;
  target: string;
  rel: string;
  source: VideoSource;
  /** Why the agent picked it ("field", "institution", "level") — null for manual. */
  matchReason: string | null;
}

export interface MatchedVideo {
  videoId: string;
  title: string;
  matchReason?: string | null;
}

/**
 * Resolve what the detail page shows.
 * Manual ids (when any are valid) REPLACE the AI matches — see rule 2.
 */
export function resolveVideoCards(
  manualIds: readonly unknown[] | null | undefined,
  aiMatches: readonly MatchedVideo[] | null | undefined,
  titleLookup: (videoId: string) => string | undefined = () => undefined,
  limit = 3,
): VideoCard[] {
  const attrs = linkAttributes();

  const manual = (manualIds ?? [])
    .map(extractVideoId)
    .filter((id): id is string => id !== null);

  if (manual.length > 0) {
    return dedupe(manual)
      .slice(0, limit)
      .map((videoId) => ({
        videoId,
        title: titleLookup(videoId) ?? 'Watch on YouTube',
        watchUrl: buildWatchUrl(videoId),
        ...attrs,
        source: 'MANUAL' as const,
        matchReason: null,
      }));
  }

  const ai = (aiMatches ?? []).filter((m) => isValidVideoId(m.videoId));
  return dedupe(ai.map((m) => m.videoId))
    .slice(0, limit)
    .map((videoId) => {
      const m = ai.find((x) => x.videoId === videoId)!;
      return {
        videoId,
        title: m.title || titleLookup(videoId) || 'Watch on YouTube',
        watchUrl: buildWatchUrl(videoId),
        ...attrs,
        source: 'AI_MATCHED' as const,
        matchReason: m.matchReason ?? null,
      };
    });
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}
