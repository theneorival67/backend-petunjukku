import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  RagReferenceDto,
  RagSearchDto,
  RagSearchResponseDto,
} from './dto/rag-search.dto';

type FastApiSourceChunk = {
  document_id?: string;
  chunk_id?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
  preview?: string;
};

type FastApiCpResolveResponse = {
  cpText?: string;
  selectedRecordId?: string | null;
  confidence?: number;
  query?: string;
  sources?: FastApiSourceChunk[];
};

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async postInternal<TResponse>(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<TResponse> {
    const cfg = this.configService.get('ai', { infer: true })!;
    const normalizedPath = path.replace(/^\//, '');
    const url = `${cfg.aiServiceBaseUrl}/${normalizedPath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (cfg.internalApiKey) {
      headers['X-Internal-API-Key'] = cfg.internalApiKey;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.warn(
          `AI FastAPI ${res.status} ${normalizedPath}: ${errText.slice(0, 300)}`,
        );
        throw new BadGatewayException(`AI FastAPI gagal (${res.status}).`);
      }

      return (await res.json()) as TResponse;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      this.logger.warn(
        `AI FastAPI request error ${normalizedPath}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      throw new ServiceUnavailableException(
        'Tidak dapat menghubungi layanan AI FastAPI internal.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(
    dto: RagSearchDto,
    user?: AuthUser,
  ): Promise<RagSearchResponseDto> {
    const fase = dto.fase?.trim();
    const mataPelajaran = dto.mataPelajaran?.trim();

    if (!fase || !mataPelajaran) {
      throw new BadRequestException(
        'fase dan mataPelajaran wajib dikirim untuk pencarian CP.',
      );
    }

    const data = await this.resolveCp({
      fase,
      mataPelajaran,
      materiPokokBahasan: dto.materiPokokBahasan?.trim() || dto.query.trim(),
      top_k: dto.top_k ?? 5,
      similarity_threshold: dto.similarity_threshold ?? 0.2,
    });

    const result = {
      query: data.query ?? dto.query,
      cpText: data.cpText ?? '',
      selectedRecordId: data.selectedRecordId ?? null,
      confidence: Number(data.confidence ?? 0),
      references: this.mapReferences(data.sources ?? []),
    };

    if (user) {
      await this.prisma.ragRetrievalLog.create({
        data: {
          userId: user.id,
          query: dto as unknown as Prisma.InputJsonValue,
          references: result.references as unknown as Prisma.InputJsonValue,
          source: 'rag-search',
        },
      });
    }

    return result;
  }

  private async resolveCp(payload: {
    fase: string;
    mataPelajaran: string;
    materiPokokBahasan?: string;
    top_k: number;
    similarity_threshold: number;
  }): Promise<FastApiCpResolveResponse> {
    const cfg = this.configService.get('ai', { infer: true })!;
    const resolvePath = cfg.ragResolvePath ?? 'cp/resolve';
    return this.postInternal<FastApiCpResolveResponse>(resolvePath, payload);
  }

  private mapReferences(sources: FastApiSourceChunk[]): RagReferenceDto[] {
    return sources.map((source) => ({
      id: String(source.chunk_id ?? ''),
      documentId: String(source.document_id ?? ''),
      similarity: Number(source.similarity ?? 0),
      preview: String(source.preview ?? ''),
      metadata: source.metadata ?? {},
    }));
  }
}
