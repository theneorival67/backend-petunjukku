import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class RecommendStageOverrideDto {
  @ApiPropertyOptional({
    description:
      'Teks CP dari flow intrakurikuler lama. Tetap diterima agar kompatibel.',
  })
  @IsOptional()
  @IsString()
  cpText?: string;

  @ApiPropertyOptional({
    description:
      'Stage yang ingin disertakan sebagai konteks tambahan untuk rekomendasi AI.',
    type: Array,
  })
  @IsOptional()
  @IsArray()
  previousStages?: unknown[];

  @ApiPropertyOptional({
    description:
      'Shortcut konteks Stage 1 bila frontend belum menyimpan stage ke database.',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  stage1?: Record<string, unknown>;
}
