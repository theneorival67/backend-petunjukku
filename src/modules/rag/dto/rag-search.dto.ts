import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class RagSearchDto {
  @ApiProperty({
    example: 'Fase D Matematika Perbandingan senilai',
    description:
      'Query pencarian bebas. Jika fase/mataPelajaran tidak dikirim, field ini dipakai sebagai konteks tambahan.',
  })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({ example: 'D' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fase?: string;

  @ApiPropertyOptional({ example: 'Matematika' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  mataPelajaran?: string;

  @ApiPropertyOptional({ example: 'Perbandingan senilai' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  materiPokokBahasan?: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  top_k?: number;

  @ApiPropertyOptional({ example: 0.2, minimum: -1, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(-1)
  @Max(1)
  similarity_threshold?: number;
}

export class RagReferenceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  documentId!: string;

  @ApiProperty()
  similarity!: number;

  @ApiProperty()
  preview!: string;

  @ApiProperty({ type: Object })
  metadata!: Record<string, unknown>;
}

export class RagSearchResponseDto {
  @ApiProperty()
  query!: string;

  @ApiProperty()
  cpText!: string;

  @ApiPropertyOptional()
  selectedRecordId!: string | null;

  @ApiProperty()
  confidence!: number;

  @ApiProperty({ type: [RagReferenceDto] })
  references!: RagReferenceDto[];
}
