import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { Browser } from 'playwright';
import { htmlToText, looksJsEmpty, looksBlocked } from './page-fetch.logic';

// PR-CATALOG-2 — the fetch edge. Ladder: axios (cheap) first; escalate a SINGLE url to a
// headless browser only when the static HTML clearly under-rendered (looksJsEmpty). Most
// server-rendered NZ institution pages never launch Chromium. Playwright is dynamically
// imported and its failure degrades to static-only — the app never crashes at boot for a
// missing browser binary. One browser is launched lazily and shared across the whole
// sweep; the orchestrator calls close() in a finally so no Chromium process leaks.

const USER_AGENT =
  'Mozilla/5.0 (compatible; SorenaCatalogBot/1.0; +https://sorena.co.nz/bot) programme-catalogue-sync';
const STATIC_TIMEOUT_MS = 15_000;
const HEADLESS_TIMEOUT_MS = 30_000;

export interface FetchedPage {
  url: string; // final URL after redirects
  html: string;
  text: string;
  status: number | null;
  renderMode: 'static' | 'headless' | 'failed';
  blocked: boolean; // bot-wall / CAPTCHA detected — we skip, never defeat it
}

export interface PageFetcher {
  fetch(url: string): Promise<FetchedPage>;
  close(): Promise<void>;
}

@Injectable()
export class PageFetchService implements PageFetcher {
  private readonly logger = new Logger(PageFetchService.name);
  private browser: Browser | null = null;
  private browserUnavailable = false;

  async fetch(url: string): Promise<FetchedPage> {
    const stat = await this.fetchStatic(url);
    // Don't spend a browser on a wall, and don't escalate a page that already rendered.
    if (stat.blocked) return stat;
    if (stat.renderMode === 'static' && !looksJsEmpty(stat.html, stat.text)) return stat;

    const rendered = await this.fetchHeadless(url);
    return rendered ?? stat; // fall back to whatever static gave us
  }

  private async fetchStatic(url: string): Promise<FetchedPage> {
    try {
      const res = await axios.get<string>(url, {
        timeout: STATIC_TIMEOUT_MS,
        maxRedirects: 5,
        responseType: 'text',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        validateStatus: () => true, // handle 4xx/5xx ourselves (block detection)
      });
      const html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      const finalUrl = (res.request?.res?.responseUrl as string) ?? url;
      return {
        url: finalUrl,
        html,
        text: htmlToText(html),
        status: res.status,
        renderMode: 'static',
        blocked: looksBlocked(res.status, html),
      };
    } catch (err: any) {
      this.logger.warn(`Static fetch failed for ${url}: ${err?.message ?? err}`);
      return { url, html: '', text: '', status: null, renderMode: 'failed', blocked: false };
    }
  }

  private async fetchHeadless(url: string): Promise<FetchedPage | null> {
    const browser = await this.ensureBrowser();
    if (!browser) return null;

    const page = await browser.newPage({ userAgent: USER_AGENT }).catch(() => null);
    if (!page) return null;
    try {
      const resp = await page.goto(url, {
        timeout: HEADLESS_TIMEOUT_MS,
        waitUntil: 'networkidle',
      });
      const html = await page.content();
      const text = (await page.innerText('body').catch(() => '')) || htmlToText(html);
      const status = resp?.status() ?? null;
      return {
        url: page.url(),
        html,
        text,
        status,
        renderMode: 'headless',
        blocked: looksBlocked(status, html),
      };
    } catch (err: any) {
      this.logger.warn(`Headless fetch failed for ${url}: ${err?.message ?? err}`);
      return null;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async ensureBrowser(): Promise<Browser | null> {
    if (this.browser) return this.browser;
    if (this.browserUnavailable) return null;
    try {
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({ headless: true });
      return this.browser;
    } catch (err: any) {
      // Missing binary / launch failure → static-only for the rest of the sweep.
      this.logger.error(
        `Headless browser unavailable — continuing static-only: ${err?.message ?? err}`,
      );
      this.browserUnavailable = true;
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}
