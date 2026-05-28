import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTeacherProfileDto {
  @ApiProperty({
    example: 'Budi Santoso',
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @ApiPropertyOptional({
    example: '081234567890',
    maxLength: 30,
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    example: 'Guru Matematika',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  position?: string;

  @ApiPropertyOptional({
    example: 'S1 Pendidikan Matematika',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  educationLevel?: string;

  @ApiPropertyOptional({
    example: 5,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  teachingExperienceYears?: number;

  @ApiPropertyOptional({
    example: 'Senang membuat pembelajaran yang kontekstual dan aktif.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional({
    example: '0f7e4e6a-4e1d-4c6f-b4f6-6d7e3a4d9a11',
    description: 'UUID sekolah yang sudah ada',
  })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  /** Nama sekolah — dibuat/dicari otomatis jika schoolId tidak ada */
  @ApiPropertyOptional({
    example: 'SMA Negeri 1',
    description:
      'Nama sekolah, dibuat atau dicari otomatis jika schoolId tidak ada',
    minLength: 2,
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  schoolName?: string;

  @ApiPropertyOptional({
    example: 'Surabaya',
    description: 'Kota/kabupaten sekolah (dari Google Places)',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  schoolCity?: string;

  @ApiPropertyOptional({
    example: 'Jawa Timur',
    description: 'Provinsi sekolah (dari Google Places)',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  schoolProvince?: string;

  @ApiPropertyOptional({
    example: 'Jl. Contoh No. 1, Surabaya',
    description: 'Alamat lengkap sekolah (dari Google Places)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  schoolAddress?: string;

  @ApiPropertyOptional({
    example: 'Beji',
    description: 'Kecamatan sekolah (dari Google Places)',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  schoolDistrict?: string;

  @ApiPropertyOptional({
    description: 'Google Place ID (dari Places API)',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  schoolPlaceId?: string;

  @ApiPropertyOptional({ description: 'Lintang (dari Google Places)' })
  @IsOptional()
  @Type(() => Number)
  schoolLatitude?: number;

  @ApiPropertyOptional({ description: 'Bujur (dari Google Places)' })
  @IsOptional()
  @Type(() => Number)
  schoolLongitude?: number;

  /** Konteks onboarding (identitas, percakapan, dll.) */
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
