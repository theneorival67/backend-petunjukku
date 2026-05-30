import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SchoolLevel, SchoolType } from '@prisma/client';

export class SearchSchoolDto {
  @ApiPropertyOptional({
    example: 'SMP Negeri',
    description: 'Kata kunci pencarian (nama atau NPSN)',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    example: 'Jawa Barat',
    description: 'Filter berdasarkan provinsi',
  })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({
    example: 'Bandung',
    description: 'Filter berdasarkan kota/kabupaten',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    example: 'SMP',
    description: 'Filter berdasarkan jenjang sekolah',
    enum: SchoolLevel,
  })
  @IsOptional()
  @IsEnum(SchoolLevel)
  school_level?: SchoolLevel;

  @ApiPropertyOptional({
    example: 'negeri',
    description: 'Filter berdasarkan tipe sekolah',
    enum: SchoolType,
  })
  @IsOptional()
  @IsEnum(SchoolType)
  school_type?: SchoolType;

  @ApiPropertyOptional({
    example: 1,
    description: 'Nomor halaman',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Jumlah data per halaman',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
