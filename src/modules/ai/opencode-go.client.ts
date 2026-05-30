import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OpencodeChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
};

@Injectable()
export class OpencodeGoClient {
  private readonly logger = new Logger(OpencodeGoClient.name);

  constructor(private readonly configService: ConfigService) {}

  private get config() {
    return this.configService.get('ai', { infer: true })!;
  }

  isConfigured(): boolean {
    const cfg = this.config;
    return Boolean(cfg?.enabled && cfg.goApiKey);
  }

  async chatCompletionText(input: {
    model?: string;
    apiPath?: string;
    messages: OpencodeChatMessage[];
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  }): Promise<string> {
    const cfg = this.config;
    if (!cfg?.enabled || !cfg.goApiKey) {
      throw new ServiceUnavailableException(
        'OpenCode Go belum dikonfigurasi (AI_ENABLED / OPENCODE_GO_API_KEY).',
      );
    }

    const apiPath = (input.apiPath ?? cfg.chatApiPath).replace(/^\//, '');
    const model = input.model ?? cfg.chatModel;
    const url = `${cfg.goBaseUrl}/${apiPath}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);

    try {
      const body: Record<string, unknown> = {
        model,
        messages: input.messages,
        max_tokens: input.maxTokens ?? cfg.maxTokens,
        temperature: input.temperature ?? 0.6,
      };

      if (input.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.goApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.warn(`OpenCode Go ${res.status}: ${errText.slice(0, 300)}`);
        throw new ServiceUnavailableException(
          `OpenCode Go gagal (${res.status})`,
        );
      }

      const data = (await res.json()) as ChatCompletionResponse;
      return this.extractAssistantText(data, input.jsonMode ?? false);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.warn(
        `OpenCode Go request error: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException(
        'Tidak dapat menghubungi OpenCode Go.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatCompletionJson<T>(input: {
    model?: string;
    apiPath?: string;
    messages: OpencodeChatMessage[];
    maxTokens?: number;
  }): Promise<T> {
    const content = await this.chatCompletionText({
      ...input,
      jsonMode: true,
      temperature: 0.3,
    });

    try {
      return JSON.parse(content) as T;
    } catch {
      throw new ServiceUnavailableException(
        'OpenCode Go mengembalikan JSON tidak valid.',
      );
    }
  }

  private extractAssistantText(
    data: ChatCompletionResponse,
    jsonMode: boolean,
  ): string {
    const message = data.choices?.[0]?.message;
    let content = message?.content?.trim() ?? '';

    if (!content && message?.reasoning_content) {
      if (jsonMode) {
        const match = message.reasoning_content.match(/\{[\s\S]*\}/);
        if (match) {
          content = match[0];
        }
      } else {
        content = message.reasoning_content.trim();
      }
    }

    if (!content) {
      throw new ServiceUnavailableException(
        'OpenCode Go mengembalikan respons kosong.',
      );
    }

    return content;
  }
}
