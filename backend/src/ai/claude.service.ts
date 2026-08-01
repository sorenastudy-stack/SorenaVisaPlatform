import { Injectable, Logger } from '@nestjs/common';
import { Anthropic } from '@anthropic-ai/sdk';

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private client: Anthropic | null = null;
  private model: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY is not set — Claude AI features will be unavailable');
    } else {
      this.client = new Anthropic({ apiKey });
    }
    this.model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.client) {
      throw new Error('Claude AI is not configured — ANTHROPIC_API_KEY is missing');
    }
    const input = `${systemPrompt}\n\nHuman: ${userMessage}\n\nAssistant:`;

    const response = await this.client.messages.create({
      model: this.model,
      messages: [{ role: 'user', content: input }],
      max_tokens: 1000,
    });

    return (response.content || [])
      .map((contentBlock) =>
        contentBlock?.type === 'text' && 'text' in contentBlock
          ? contentBlock.text
          : '',
      )
      .join('')
      .trim();
  }

  // PR-CATALOG-2 — structured extraction for the monthly web re-sync. Additive: the
  // existing chat() above is untouched. Differs deliberately — a real `system` field
  // (not crammed into the user turn), a larger token budget (page extraction needs far
  // more than chat's 1000), and retry/backoff on transient 429/5xx/overloaded, since a
  // sweep fires hundreds of calls and must not fail the whole run on one throttle.
  // Returns the raw text; JSON parsing lives in the pure programme-extract logic so it
  // stays unit-testable without a live API.
  async extractJson(
    systemPrompt: string,
    userMessage: string,
    opts?: { maxTokens?: number; retries?: number },
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Claude AI is not configured — ANTHROPIC_API_KEY is missing');
    }
    const maxTokens = opts?.maxTokens ?? 4096;
    const retries = opts?.retries ?? 3;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: maxTokens,
        });
        return (response.content || [])
          .map((b) => (b?.type === 'text' && 'text' in b ? b.text : ''))
          .join('')
          .trim();
      } catch (err: any) {
        lastErr = err;
        const status = err?.status ?? err?.response?.status;
        const retriable =
          status === 429 || status === 529 || (status >= 500 && status < 600);
        if (attempt < retries && retriable) {
          const backoffMs = Math.min(8000, 500 * 2 ** attempt);
          this.logger.warn(
            `Claude extract hit ${status} — retry ${attempt + 1}/${retries} in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
}
