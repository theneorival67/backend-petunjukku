import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

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

  @ApiPropertyOptional({
    description:
      'Tema proyek PjBL yang dipilih guru. Jika kosong, AI mengembalikan rekomendasi tema; jika terisi, AI mengembalikan opsi proyek untuk tema tersebut.',
  })
  @IsOptional()
  @Allow()
  selectedTheme?: string | Record<string, unknown>;
}
