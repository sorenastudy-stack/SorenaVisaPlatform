import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../claude.service';
import { YoutubeCorpusService, type CorpusVideo } from './youtube-corpus.service';
import { isValidVideoId, type MatchedVideo } from './video-links.logic';

// PR-EXPLORE — the CONTENT_MATCHING agent. Mirrors CvGenerationAgent: it OWNS its
// prompt and its Claude call, and NEVER throws — on any failure it returns
// { videos: [], available: false } so the programme detail page renders without a
// video block rather than erroring.
//
// WHY NOT snippet.tags: verified against the live channel — Shorts/English uploads
// return NO tags at all, and long-form uploads share the SAME 22 generic channel-level
// keywords (مهاجرت, ویزا کار نیوزلند …). Tags identify the channel, not the video, so
// they cannot discriminate "Master of IT at Auckland" from "NZCEL language course".
// Matching therefore runs on TITLE + DESCRIPTION + HASHTAGS, with tags passed only as
// a weak supporting signal. (Owner-confirmed.)
//
// The channel is bilingual (English + Persian). Claude reads both, so a Persian video
// can legitimately match an English programme record — no translation step needed.

export interface ProgrammeMatchInput {
  programmeName: string;
  institutionName: string;
  city: string | null;
  level: string | null;
  studyFields: string[];
}

export interface ContentMatchResult {
  videos: MatchedVideo[];
  available: boolean;
}

const MAX_VIDEOS = 3;

@Injectable()
export class ContentMatchingAgent {
  private readonly logger = new Logger(ContentMatchingAgent.name);

  constructor(
    private readonly claude: ClaudeService,
    private readonly corpus: YoutubeCorpusService,
  ) {}

  private buildPrompt(
    programme: ProgrammeMatchInput,
    videos: CorpusVideo[],
  ): { system: string; user: string } {
    const system = [
      'You match videos from a New Zealand study-abroad YouTube channel to a specific study programme.',
      `Return ONLY JSON: {"matches":[{"videoId":string,"reason":string}]} with at most ${MAX_VIDEOS} entries.`,
      '',
      'Rules:',
      '- Pick ONLY videos genuinely relevant to this programme: its field of study, its qualification',
      '  level, its institution, or its city. Relevance to New Zealand study in general is NOT enough.',
      '- `reason` must be ONE of: "field", "institution", "level", "city". Nothing else.',
      '- The channel is bilingual (English and Persian). A Persian-language video is a valid match —',
      '  judge it on meaning, not language.',
      '- Titles often carry the real topic as #hashtags. Weight title, description and hashtags heavily.',
      '- The `tags` field is channel-wide boilerplate repeated across unrelated videos. It is a WEAK',
      '  signal only — never match on tags alone.',
      '- Return FEWER matches, or an empty array, rather than padding with loosely-related videos.',
      '  An empty result is a correct answer when nothing fits.',
      '- videoId must be copied EXACTLY from the candidate list. Never invent one.',
      'No prose outside the JSON.',
    ].join('\n');

    const target = [
      `Programme: ${programme.programmeName}`,
      `Institution: ${programme.institutionName}`,
      programme.city ? `City: ${programme.city}` : null,
      programme.level ? `Qualification level: ${programme.level}` : null,
      programme.studyFields.length ? `Field(s) of study: ${programme.studyFields.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    // Descriptions are truncated: the topic lives in the first couple of lines, and
    // 186 full descriptions would bloat the prompt for no matching benefit.
    const candidates = videos.map((v) => ({
      videoId: v.videoId,
      title: v.title,
      description: v.description.slice(0, 300),
      hashtags: v.hashtags,
      tags: v.tags.slice(0, 5),
    }));

    const user = [
      'Target programme:',
      target,
      '',
      `Candidate videos (${candidates.length}):`,
      JSON.stringify(candidates),
    ].join('\n');

    return { system, user };
  }

  /** Never throws. Returns available:false when matching could not run. */
  async matchVideos(programme: ProgrammeMatchInput): Promise<ContentMatchResult> {
    const videos = await this.corpus.getCorpus();
    if (!videos.length) {
      this.logger.warn('Video corpus empty — skipping match');
      return { videos: [], available: false };
    }

    const { system, user } = this.buildPrompt(programme, videos);
    try {
      const raw = await this.claude.chat(system, user);
      const parsed = parseMatches(raw);
      const byId = new Map(videos.map((v) => [v.videoId, v]));

      // Keep only ids that exist in the corpus — a hallucinated id can never
      // become a link on the page.
      const matched: MatchedVideo[] = [];
      for (const m of parsed) {
        if (!isValidVideoId(m.videoId)) continue;
        const v = byId.get(m.videoId);
        if (!v) {
          this.logger.warn(`Agent returned an id not in the corpus: ${m.videoId}`);
          continue;
        }
        matched.push({ videoId: v.videoId, title: v.title, matchReason: m.reason ?? null });
        if (matched.length >= MAX_VIDEOS) break;
      }
      return { videos: matched, available: true };
    } catch (err) {
      this.logger.error(`Video matching failed: ${(err as Error).message}`);
      return { videos: [], available: false };
    }
  }
}

/** Tolerates a fenced or prose-wrapped JSON response. Returns [] on anything unusable. */
export function parseMatches(raw: string): Array<{ videoId: string; reason?: string }> {
  if (!raw) return [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  try {
    const obj = JSON.parse(body.slice(start, end + 1));
    const arr = Array.isArray(obj?.matches) ? obj.matches : [];
    return arr
      .filter((m: any) => m && typeof m.videoId === 'string')
      .map((m: any) => ({ videoId: m.videoId, reason: typeof m.reason === 'string' ? m.reason : undefined }));
  } catch {
    return [];
  }
}
