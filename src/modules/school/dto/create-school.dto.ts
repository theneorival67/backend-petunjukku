import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SchoolLevel, SchoolType } from '@prisma/client';

export class CreateSchoolDto {
  @ApiProperty({
    example: 'SMP Negeri 1 Bandung',
    description: 'Nama sekolah',
    minLength: 2,
    maxLength: 200,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example: '12345678',
    description: 'Nomor Pokok Sekolah Nasional',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  npsn?: string;

  @ApiPropertyOptional({
    example: 'Jawa Barat',
    description: 'Provinsi lokasi sekolah',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  province?: string;

  @ApiPropertyOptional({
    example: 'Bandung',
    description: 'Kota/kabupaten lokasi sekolah',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({
    example: 'Coblong',
    description: 'Kecamatan lokasi sekolah',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({
    example: 'Jl. Contoh No. 1',
    description: 'Alamat lengkap sekolah',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({
    example: 'SMP',
    description: 'Jenjang sekolah',
    enum: SchoolLevel,
  })
  @IsOptional()
  @IsEnum(SchoolLevel)
  school_level?: SchoolLevel;

  @ApiPropertyOptional({
    example: 'negeri',
    description: 'Tipe sekolah (negeri/swasta)',
    enum: SchoolType,
  })
  @IsOptional()
  @IsEnum(SchoolType)
  school_type?: SchoolType;
}
