import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic, { APIError } from '@anthropic-ai/sdk';

// PR-DASH-4 — Thin wrapper around @anthropic-ai/sdk.
//
// Centralises:
//   * Key + model loading from env (ANTHROPIC_API_KEY,
//     ANTHROPIC_CHATBOT_MODEL — defaults to the haiku string in the
//     spec).
//   * Error mapping: distinguishes "service unavailable" (timeout /
//     network) from "rate limited" (Anthropic 429) from "any other".
//     The chatbot service translates these into the HTTP codes the
//     spec requires.
//
// Defensive default: if ANTHROPIC_API_KEY is missing in production,
// onModuleInit throws so the app refuses to boot rather than
// quietly serving 500s on every chat message.

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicCallResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  modelUsed: string;
}

// Discriminated union so callers can branch on the error kind.
// `service.ts` maps these to 503 / 429 / 500 respectively.
export type AnthropicCallError =
  | { kind: 'UNAVAILABLE'; cause?: unknown }
  | { kind: 'RATE_LIMITED'; cause?: unknown }
  | { kind: 'OTHER';        cause?: unknown };

@Injectable()
export class AnthropicClient implements OnModuleInit {
  private readonly logger = new Logger(AnthropicClient.name);
  private client: Anthropic | null = null;
  private model = 'claude-haiku-4-5-20251001';
  private apiKey: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.apiKey = this.config.get<string>('ANTHROPIC_API_KEY') ?? '';
    const modelOverride = this.config.get<string>('ANTHROPIC_CHATBOT_MODEL');
    if (modelOverride && modelOverride.trim() !== '') {
      this.model = modelOverride.trim();
    }
    if (this.apiKey.trim() === '') {
      const env = this.config.get<string>('NODE_ENV') ?? 'development';
      const msg = `[chatbot] ANTHROPIC_API_KEY is not set; chatbot endpoints will return 503 until it's configured.`;
      if (env === 'production') {
        // Fail fast in prod — silent 503s on a customer-facing
        // feature are worse than a hard boot failure.
        throw new Error(msg);
      }
      this.logger.warn(msg);
      return;
    }
    this.client = new Anthropic({ apiKey: this.apiKey });
  }

  // Returns either a result or a typed error envelope. We don't
  // throw here so the service can choose the response code cleanly.
  async createMessage(args: {
    system: string;
    messages: AnthropicMessage[];
    maxTokens?: number;
  }): Promise<{ ok: true; result: AnthropicCallResult } | { ok: false; error: AnthropicCallError }> {
    if (!this.client) {
      return { ok: false, error: { kind: 'UNAVAILABLE' } };
    }
    try {
      const resp = await this.client.messages.create({
        model:      this.model,
        max_tokens: args.maxTokens ?? 800,
        system:     args.system,
        messages:   args.messages,
      });
      // Concatenate any text content blocks. Tool use / image / thinking
      // blocks aren't expected from this prompt but we silently
      // ignore them rather than crashing. We avoid a type predicate
      // here because newer SDK TextBlock types carry citations[] that
      // would force us to construct objects we don't have.
      const text = (resp.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => (c as unknown as { text: string }).text ?? '')
        .join('\n')
        .trim();
      return {
        ok: true,
        result: {
          text,
          inputTokens:  resp.usage?.input_tokens ?? null,
          outputTokens: resp.usage?.output_tokens ?? null,
          modelUsed:    resp.model ?? this.model,
        },
      };
    } catch (err) {
      if (err instanceof APIError) {
        if (err.status === 429) {
          return { ok: false, error: { kind: 'RATE_LIMITED', cause: err.message } };
        }
        if (err.status === 408 || err.status === 502 || err.status === 503 || err.status === 504) {
          return { ok: false, error: { kind: 'UNAVAILABLE', cause: err.message } };
        }
        this.logger.error(`[chatbot] Anthropic API error ${err.status}: ${err.message}`);
        return { ok: false, error: { kind: 'OTHER', cause: err.message } };
      }
      // Network / abort / timeout / non-API thrown error.
      const message = err instanceof Error ? err.message : String(err);
      // ECONNRESET / ETIMEDOUT / fetch failure → unavailable; the
      // student should be told to retry.
      if (/ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|abort|timeout|network/i.test(message)) {
        return { ok: false, error: { kind: 'UNAVAILABLE', cause: message } };
      }
      this.logger.error(`[chatbot] Anthropic client error: ${message}`);
      return { ok: false, error: { kind: 'OTHER', cause: message } };
    }
  }

  // Exposed for the audit-log row so we know which model variant
  // produced each historical reply.
  get currentModel(): string {
    return this.model;
  }
}
