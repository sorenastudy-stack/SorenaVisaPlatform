import { Injectable, Logger } from '@nestjs/common';

// PR-EXPLORE — fetches and caches the Sorena Visa channel's video corpus.
//
// QUOTA ARCHITECTURE (Owner-approved): YouTube Data API gives 10,000 units/day and
// search.list costs 100 units PER CALL, while playlistItems.list and videos.list cost
// 1 each. Matching per page-view via search would exhaust the daily quota in ~100
// requests. Instead we pull the whole uploads playlist ONCE (~8 units for 186 videos
// at 50/page) and cache it; Claude then matches against the cached set, so matching
// itself costs zero YouTube quota.
//
// Cache is in-process with a TTL. A restart re-fetches (~8 units), which is cheap
// enough that persisting to Postgres is not worth a table yet — revisit if we ever
// run many instances.

export const SORENA_CHANNEL_ID = 'UCIcWuwUtdcUs1m4QNF1r0hA'; // @sorena_visa (Owner-confirmed)

const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export interface CorpusVideo {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  /** Present on some uploads only — channel-level boilerplate, weak signal. */
  tags: string[];
  /** #hashtags parsed out of the title/description — the real topic signal. */
  hashtags: string[];
}

@Injectable()
export class YoutubeCorpusService {
  private readonly logger = new Logger(YoutubeCorpusService.name);
  private cache: { at: number; videos: CorpusVideo[] } | null = null;

  private get apiKey(): string | undefined {
    return process.env.YOUTUBE_API_KEY;
  }

  /** Cached corpus. Never throws — returns [] so the page degrades to "no videos". */
  async getCorpus(force = false): Promise<CorpusVideo[]> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.videos;
    }
    if (!this.apiKey) {
      this.logger.warn('YOUTUBE_API_KEY is not set — video matching unavailable');
      return this.cache?.videos ?? [];
    }
    try {
      const videos = await this.fetchAll();
      this.cache = { at: Date.now(), videos };
      this.logger.log(`Cached ${videos.length} videos from the Sorena Visa channel`);
      return videos;
    } catch (err) {
      this.logger.error(`YouTube corpus fetch failed: ${(err as Error).message}`);
      return this.cache?.videos ?? []; // stale-but-usable beats empty
    }
  }

  private async fetchAll(): Promise<CorpusVideo[]> {
    const uploads = await this.uploadsPlaylistId();
    const ids: string[] = [];
    let pageToken = '';
    do {
      const url =
        `${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}` +
        `&key=${this.apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const page = await this.get(url);
      for (const item of page.items ?? []) {
        const id = item?.contentDetails?.videoId;
        if (id) ids.push(id);
      }
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);

    const videos: CorpusVideo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50).join(',');
      const res = await this.get(`${API}/videos?part=snippet&id=${batch}&key=${this.apiKey}`);
      for (const v of res.items ?? []) {
        const title: string = v.snippet?.title ?? '';
        const description: string = v.snippet?.description ?? '';
        videos.push({
          videoId: v.id,
          title,
          description,
          publishedAt: v.snippet?.publishedAt ?? '',
          tags: v.snippet?.tags ?? [],
          hashtags: extractHashtags(`${title}\n${description}`),
        });
      }
    }
    return videos;
  }

  private async uploadsPlaylistId(): Promise<string> {
    const res = await this.get(
      `${API}/channels?part=contentDetails&id=${SORENA_CHANNEL_ID}&key=${this.apiKey}`,
    );
    const id = res.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!id) throw new Error(`No uploads playlist for channel ${SORENA_CHANNEL_ID}`);
    return id;
  }

  private async get(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
}

/** "#studentvisa #auckland" → ["studentvisa","auckland"]. Handles Persian too. */
export function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}
