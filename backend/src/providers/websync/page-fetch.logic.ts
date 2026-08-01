// PR-CATALOG-2 — pure helpers for the fetch layer. No network here: HTML→text cleaning,
// the "should we escalate to a headless browser?" heuristic, link harvesting for the
// discovery index page, and bot-wall detection are all deterministic and golden-tested.
// The actual axios/Playwright I/O lives in PageFetchService.

const BLOCK_MARKERS =
  /captcha|cf-browser-verification|attention required|access denied|are you a (?:human|robot)|just a moment\.\.\./i;
const JS_REQUIRED_MARKERS = /please enable javascript|enable javascript to|requires javascript/i;
const EMPTY_SPA_MOUNT = /<div[^>]+id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i;

// Strip scripts/styles/head so the remaining text is what a reader would see. Crude but
// enough — the AI does the real reading; we only need clean-ish text and a length signal.
export function htmlToText(html: string): string {
  return (html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|head|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Should this page be re-fetched with a headless browser? True when the static HTML
// clearly under-rendered: explicit "enable JavaScript", almost no visible text, or an
// empty SPA mount with little content. Most server-rendered NZ pages return false and
// never launch Chromium.
export function looksJsEmpty(html: string, text: string, minTextChars = 200): boolean {
  if (JS_REQUIRED_MARKERS.test(html)) return true;
  if (text.trim().length < minTextChars) return true;
  if (EMPTY_SPA_MOUNT.test(html) && text.trim().length < 600) return true;
  return false;
}

// Bot-wall / CAPTCHA detection. We detect and skip — we never try to defeat it.
export function looksBlocked(status: number | null, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  return BLOCK_MARKERS.test(html || '');
}

// Resolve a possibly-relative href to an absolute http(s) URL, dropping the fragment and
// non-navigational schemes. Returns null for anything we shouldn't crawl.
export function absolutize(href: string, baseUrl: string): string | null {
  if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href.trim())) return null;
  try {
    const u = new URL(href, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function sameHost(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
}

// Harvest candidate links from a catalogue/index page. Absolute, de-duped, and (by
// default) restricted to the institution's own host so we don't wander off-site.
export function extractLinks(html: string, baseUrl: string, onlySameHost = true): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ''))) {
    const abs = absolutize(m[1], baseUrl);
    if (abs && (!onlySameHost || sameHost(abs, baseUrl))) out.add(abs);
  }
  return [...out];
}
