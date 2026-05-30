import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private readonly configService: ConfigService) {}

  async search(dto: RagSearchDto): Promise<RagSearchResponseDto> {
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

    return {
      query: data.query ?? dto.query,
      cpText: data.cpText ?? '',
      selectedRecordId: data.selectedRecordId ?? null,
      confidence: Number(data.confidence ?? 0),
      references: this.mapReferences(data.sources ?? []),
    };
  }

  private async resolveCp(payload: {
    fase: string;
    mataPelajaran: string;
    materiPokokBahasan?: string;
    top_k: number;
    similarity_threshold: number;
  }): Promise<FastApiCpResolveResponse> {
    const cfg = this.configService.get('ai', { infer: true })!;
    const resolvePath = (cfg.ragResolvePath ?? 'cp/resolve').replace(
      /^\//,
      '',
    );
    const url = `${cfg.ragBaseUrl}/${resolvePath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.warn(`RAG FastAPI ${res.status}: ${errText.slice(0, 300)}`);
        throw new BadGatewayException(`RAG FastAPI gagal (${res.status}).`);
      }

      return (await res.json()) as FastApiCpResolveResponse;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      this.logger.warn(
        `RAG FastAPI request error: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException(
        'Tidak dapat menghubungi layanan RAG FastAPI.',
      );
    } finally {
      clearTimeout(timeout);
    }
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
