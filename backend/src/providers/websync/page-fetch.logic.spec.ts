// PR-CATALOG-2 — golden battery for the pure fetch helpers. Frozen before the crawl is
// wired. Focus: the escalate-to-headless heuristic, bot-wall detection, and safe link
// harvesting (absolute, same-host, no junk schemes).
import {
  htmlToText,
  looksJsEmpty,
  looksBlocked,
  absolutize,
  sameHost,
  extractLinks,
} from './page-fetch.logic';

describe('htmlToText', () => {
  it('strips scripts/styles/tags and decodes basic entities', () => {
    const html = '<head><title>x</title></head><body><script>var a=1</script><p>Bachelor &amp; Master</p><style>.a{}</style></body>';
    expect(htmlToText(html)).toBe('Bachelor & Master');
  });
});

describe('looksJsEmpty — escalate to headless only when needed', () => {
  it('is false for a normal server-rendered page', () => {
    const text = 'x'.repeat(500);
    expect(looksJsEmpty('<body>' + text + '</body>', text)).toBe(false);
  });
  it('is true when there is almost no visible text', () => {
    expect(looksJsEmpty('<body></body>', '')).toBe(true);
  });
  it('is true on an explicit "enable JavaScript" page', () => {
    const html = '<body>Please enable JavaScript to view this site</body>';
    expect(looksJsEmpty(html, htmlToText(html))).toBe(true);
  });
  it('is true for an empty SPA mount with little content', () => {
    const html = '<body><div id="root"></div></body>';
    expect(looksJsEmpty(html, htmlToText(html))).toBe(true);
  });
});

describe('looksBlocked — detect bot-walls, never defeat them', () => {
  it('flags blocking status codes', () => {
    expect(looksBlocked(403, '')).toBe(true);
    expect(looksBlocked(429, '')).toBe(true);
    expect(looksBlocked(503, '')).toBe(true);
  });
  it('flags CAPTCHA / challenge markers', () => {
    expect(looksBlocked(200, '<h1>Attention Required! | Cloudflare</h1>')).toBe(true);
    expect(looksBlocked(200, '<title>Just a moment...</title>')).toBe(true);
  });
  it('passes a normal page', () => {
    expect(looksBlocked(200, '<h1>Bachelor of Computing</h1>')).toBe(false);
  });
});

describe('absolutize / sameHost', () => {
  const base = 'https://uni.ac.nz/study/index';
  it('resolves relative links and drops the fragment', () => {
    expect(absolutize('../prog/bcs#top', base)).toBe('https://uni.ac.nz/prog/bcs');
    expect(absolutize('/a/b', base)).toBe('https://uni.ac.nz/a/b');
  });
  it('rejects non-navigational schemes', () => {
    expect(absolutize('mailto:x@y.z', base)).toBeNull();
    expect(absolutize('javascript:void(0)', base)).toBeNull();
    expect(absolutize('#section', base)).toBeNull();
  });
  it('sameHost compares host', () => {
    expect(sameHost('https://uni.ac.nz/x', base)).toBe(true);
    expect(sameHost('https://other.com/x', base)).toBe(false);
  });
});

describe('extractLinks — harvest candidate programme links', () => {
  const base = 'https://uni.ac.nz/study/index';
  const html = `
    <a href="/prog/bcs">CS</a>
    <a href="prog/nursing">Nursing</a>
    <a href="https://uni.ac.nz/prog/bcs">CS dup</a>
    <a href="https://facebook.com/uni">social</a>
    <a href="mailto:x@y.z">email</a>
    <a href="#top">top</a>`;
  it('returns absolute, de-duped, same-host links only', () => {
    const links = extractLinks(html, base);
    expect(links).toContain('https://uni.ac.nz/prog/bcs');
    expect(links).toContain('https://uni.ac.nz/study/prog/nursing');
    expect(links).not.toContain('https://facebook.com/uni'); // off-host dropped
    expect(links.filter((l) => l === 'https://uni.ac.nz/prog/bcs')).toHaveLength(1); // de-duped
    expect(links.some((l) => l.startsWith('mailto'))).toBe(false);
  });
  it('can include off-host links when asked', () => {
    expect(extractLinks(html, base, false)).toContain('https://facebook.com/uni');
  });
});
