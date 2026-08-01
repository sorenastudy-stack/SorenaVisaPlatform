import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../../ai/claude.service';
import {
  buildExtractionPrompt,
  parseExtractionResponse,
  normalizeCandidate,
  type ExtractCtx,
  type NormalizedCandidate,
} from './programme-extract.logic';

// PR-CATALOG-2 — the I/O edge of extraction. All the mapping/confidence logic is in the
// pure programme-extract.logic (golden-tested); this only wires the Claude call to it.
// The interface lets the orchestrator's integration smoke inject a fake extractor so it
// runs with no live API and no network.
export interface ProgrammeExtractor {
  extractProgramme(pageText: string, ctx: ExtractCtx): Promise<NormalizedCandidate[]>;
}

@Injectable()
export class ProgrammeExtractionService implements ProgrammeExtractor {
  private readonly logger = new Logger(ProgrammeExtractionService.name);

  constructor(private readonly claude: ClaudeService) {}

  async extractProgramme(pageText: string, ctx: ExtractCtx): Promise<NormalizedCandidate[]> {
    const { system, user } = buildExtractionPrompt(pageText);
    let raw: string;
    try {
      raw = await this.claude.extractJson(system, user, { maxTokens: 4096 });
    } catch (err: any) {
      // A single page's extraction failure must never abort the sweep.
      this.logger.warn(`Extraction failed for ${ctx.sourceUrl}: ${err?.message ?? err}`);
      return [];
    }
    return parseExtractionResponse(raw)
      .map((e) => normalizeCandidate(e, ctx))
      .filter((c): c is NormalizedCandidate => c != null);
  }
}
