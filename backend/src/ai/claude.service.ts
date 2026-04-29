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
}
