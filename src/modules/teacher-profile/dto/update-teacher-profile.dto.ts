import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateTeacherProfileDto {
  @ApiPropertyOptional({
    example: 'Budi Santoso Updated',
    minLength: 2,
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({
    example: '0f7e4e6a-4e1d-4c6f-b4f6-6d7e3a4d9a11',
    description: 'UUID sekolah yang sudah ada',
  })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({
    example: 'SMA Negeri 2',
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

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
