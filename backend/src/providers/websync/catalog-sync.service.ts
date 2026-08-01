import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PageFetchService, type PageFetcher } from './page-fetch.service';
import { ProgrammeExtractionService, type ProgrammeExtractor } from './programme-extraction.service';
import { extractLinks } from './page-fetch.logic';
import {
  diffMonitoredFields,
  sameChange,
  storedNatKey,
  candidateNatKey,
  routeCandidates,
  type ChangedFields,
} from './catalog-sync.logic';

// PR-CATALOG-2 — the monthly sweep orchestrator. Two passes per ACTIVE provider:
//   A. Monitoring — each approved programme's programmeUrl → extract → diff → change proposal.
//   B. Discovery  — the provider's catalogueUrl index → unknown links → extract → candidate.
// Nothing is auto-published: every finding lands PENDING in the shared review queue.
// Deterministic decisions (diff/dedupe/route) live in catalog-sync.logic (golden-tested);
// this file is the DB + network + browser-lifecycle edge, kept crash-isolated at every
// level (one page's failure never aborts a provider; one provider never aborts the sweep).

const DISCOVERY_CANDIDATE_CAP = 25; // per provider per run surfaced to the main queue
const MAX_INDEX_LINKS = 400; // bound the candidate links considered from one index page
const DEFAULT_THROTTLE_MS = 1500; // politeness between same-provider fetches

export interface SweepReport {
  providersScanned: number;
  pagesFetched: number;
  changeProposals: number;
  candidatesCreated: number;
  lowConfidenceSkipped: number;
  cappedSkipped: number;
  blocked: string[];
  discoverySkipped: { provider: string; reason: string }[];
  notes: string[];
}

interface SweepDeps {
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  throttleMs?: number;
}

@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly throttleMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: PageFetcher & PageFetchService,
    private readonly extractor: ProgrammeExtractor & ProgrammeExtractionService,
    deps: SweepDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  private empty(): SweepReport {
    return {
      providersScanned: 0, pagesFetched: 0, changeProposals: 0, candidatesCreated: 0,
      lowConfidenceSkipped: 0, cappedSkipped: 0, blocked: [], discoverySkipped: [], notes: [],
    };
  }

  private throttle(): Promise<void> {
    return this.throttleMs > 0 ? this.sleep(this.throttleMs) : Promise.resolve();
  }

  // Entry point. opts.providerId narrows to one institution (manual "sync now"); dryRun
  // does everything except the writes. Always closes the browser, even on a crash.
  async runSweep(opts: { providerId?: string; dryRun?: boolean } = {}): Promise<SweepReport> {
    const report = this.empty();
    const providers = await this.prisma.educationProvider.findMany({
      where: { status: 'ACTIVE', ...(opts.providerId ? { id: opts.providerId } : {}) },
      select: { id: true, name: true, catalogueUrl: true },
    });
    try {
      for (const p of providers) {
        report.providersScanned++;
        // Provider-level crash isolation: one bad institution never stops the sweep.
        try {
          await this.monitorProvider(p, report, opts);
        } catch (err: any) {
          this.logger.error(`[Monitor] ${p.name} failed: ${err?.message ?? err}`);
        }
        try {
          await this.discoverProvider(p, report, opts);
        } catch (err: any) {
          this.logger.error(`[Discover] ${p.name} failed: ${err?.message ?? err}`);
        }
      }
    } finally {
      await this.fetcher.close();
    }
    return report;
  }

  // Pass A — change monitoring on already-approved programmes.
  private async monitorProvider(
    p: { id: string; name: string },
    report: SweepReport,
    opts: { dryRun?: boolean },
  ): Promise<void> {
    const programmes = await this.prisma.educationProgramme.findMany({
      where: { providerId: p.id, reviewStatus: 'APPROVED', programmeUrl: { not: null } },
      select: {
        id: true, programmeUrl: true, tuitionFeeNZD: true, nzqfLevel: true,
        durationMonths: true, campusCity: true, qualificationType: true,
      },
    });

    for (const prog of programmes) {
      const url = prog.programmeUrl!;
      await this.throttle();
      const page = await this.fetcher.fetch(url);
      report.pagesFetched++;
      if (page.blocked) { report.blocked.push(`${p.name} — ${url}`); continue; }
      if (!page.text) continue;

      const cands = await this.extractor.extractProgramme(page.text, { providerId: p.id, sourceUrl: url });
      const best = cands[0];
      if (!best) continue;

      const changed = diffMonitoredFields(prog, best);
      if (Object.keys(changed).length === 0) continue;

      // One live proposal per programme: update the pending one if the change moved, else create.
      const existing = await this.prisma.programmeChangeProposal.findFirst({
        where: { programmeId: prog.id, status: 'PENDING' },
        select: { id: true, changedFields: true },
      });
      if (existing && sameChange(existing.changedFields as ChangedFields, changed)) continue;
      if (opts.dryRun) { report.changeProposals++; continue; }

      if (existing) {
        await this.prisma.programmeChangeProposal.update({
          where: { id: existing.id },
          data: { changedFields: changed as any, sourceUrl: url, detectedAt: this.now() },
        });
      } else {
        await this.prisma.programmeChangeProposal.create({
          data: { programmeId: prog.id, source: 'AUTOMATED_WEB_CHECK', changedFields: changed as any, sourceUrl: url },
        });
      }
      report.changeProposals++;
    }
  }

  // Pass B — new-programme discovery from the provider's catalogue index.
  private async discoverProvider(
    p: { id: string; name: string; catalogueUrl: string | null },
    report: SweepReport,
    opts: { dryRun?: boolean },
  ): Promise<void> {
    if (!p.catalogueUrl) {
      report.discoverySkipped.push({ provider: p.name, reason: 'no catalogueUrl configured' });
      return;
    }
    // First-run guard: discovery diffs against a baseline — an empty institution is seeded
    // via the reliable Excel import, not a cold-start AI crawl of its whole site.
    const baseline = await this.prisma.educationProgramme.count({ where: { providerId: p.id } });
    if (baseline === 0) {
      report.discoverySkipped.push({ provider: p.name, reason: 'no programme baseline — seed via Excel first' });
      return;
    }

    await this.throttle();
    const index = await this.fetcher.fetch(p.catalogueUrl);
    report.pagesFetched++;
    if (index.blocked) { report.blocked.push(`${p.name} — ${p.catalogueUrl} (index)`); return; }
    const links = extractLinks(index.html, index.url).slice(0, MAX_INDEX_LINKS);

    // Build dedupe sets from BOTH existing programmes and existing candidates (incl. REJECTED,
    // so a rejected candidate never resurfaces next sweep).
    const [existingProgrammes, existingCandidates] = await Promise.all([
      this.prisma.educationProgramme.findMany({
        where: { providerId: p.id },
        select: { name: true, nzqfLevel: true, campusCity: true, programmeUrl: true },
      }),
      this.prisma.programmeCandidate.findMany({
        where: { providerId: p.id },
        select: { nameNormalized: true, nzqfLevel: true, campusCity: true, sourceUrl: true },
      }),
    ]);
    const knownUrls = new Set<string>([
      ...existingProgrammes.map((x) => x.programmeUrl).filter((u): u is string => !!u),
      ...existingCandidates.map((x) => x.sourceUrl),
    ]);
    const knownKeys = new Set<string>([
      ...existingProgrammes.map((x) => storedNatKey(x.name, x.nzqfLevel, x.campusCity)),
      ...existingCandidates.map((x) => `${x.nameNormalized}|${x.nzqfLevel ?? ''}|${x.campusCity ?? ''}`),
    ]);

    const fresh = [];
    for (const link of links) {
      if (knownUrls.has(link)) continue; // URL-level dedupe (cheap, avoids a fetch)
      await this.throttle();
      const page = await this.fetcher.fetch(link);
      report.pagesFetched++;
      if (page.blocked) { report.blocked.push(`${p.name} — ${link}`); continue; }
      if (!page.text) continue;

      const cands = await this.extractor.extractProgramme(page.text, { providerId: p.id, sourceUrl: link });
      for (const c of cands) {
        const key = candidateNatKey(c);
        if (knownKeys.has(key)) continue; // name/level/campus dedupe (incl. rejected)
        knownKeys.add(key); // guard against intra-run duplicates across pages
        fresh.push(c);
      }
    }

    const routed = routeCandidates(fresh, DISCOVERY_CANDIDATE_CAP);
    report.lowConfidenceSkipped += routed.lowConfidenceCount;
    report.cappedSkipped += routed.cappedCount;
    if (routed.cappedCount > 0) {
      report.notes.push(`${p.name}: ${routed.cappedCount} candidate(s) capped this run — raise the cap or import via Excel`);
    }
    if (routed.lowConfidenceCount > 0) {
      report.notes.push(`${p.name}: ${routed.lowConfidenceCount} low-confidence page(s) skipped (kept out of the queue)`);
    }

    for (const c of routed.surfaced) {
      if (opts.dryRun) { report.candidatesCreated++; continue; }
      await this.prisma.programmeCandidate.create({
        data: {
          providerId: p.id,
          source: 'AUTOMATED_WEB_CHECK',
          sourceUrl: c.proposedData.programme.sourceRef,
          proposedData: c.proposedData as any,
          confidence: c.confidence,
          detectedFields: c.detectedFields,
          nameNormalized: c.nameNormalized,
          nzqfLevel: c.nzqfLevel,
          campusCity: c.campusCity,
        },
      });
      report.candidatesCreated++;
    }
  }
}
