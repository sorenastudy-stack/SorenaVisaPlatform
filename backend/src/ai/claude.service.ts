import { Injectable } from '@nestjs/common';
import { Anthropic } from '@anthropic-ai/sdk';

@Injectable()
export class ClaudeService {
  private client: Anthropic;
  private model: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    this.client = new Anthropic({ apiKey });
    this.model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
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
