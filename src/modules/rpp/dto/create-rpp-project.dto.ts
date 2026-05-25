import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RppType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRppProjectDto {
  @ApiProperty({
    example: 'RPP Sistem Pencernaan Manusia',
    minLength: 3,
    maxLength: 200,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiProperty({
    enum: RppType,
    example: RppType.intrakurikuler,
    description: 'Jenis RPP: intrakurikuler atau pjbl_kokurikuler',
  })
  @IsEnum(RppType)
  rppType: RppType;

  @ApiPropertyOptional({
    example: 'd7e4f6c0-1234-4d4f-a123-123456789abc',
    description: 'ID mapel guru dari teacher_subjects',
  })
  @IsOptional()
  @IsUUID()
  teacherSubjectId?: string;

  @ApiPropertyOptional({
    example: 'a2c1f9b0-1234-4d4f-a123-123456789abc',
    description: 'ID kelas guru dari teacher_classes',
  })
  @IsOptional()
  @IsUUID()
  teacherClassId?: string;

  @ApiPropertyOptional({
    example: 'IPA',
    description:
      'Opsional jika teacherSubjectId sudah dikirim. Jika kosong, akan diambil dari teacher_subjects.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subject?: string;

  @ApiPropertyOptional({
    example: 'Fase D',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phase?: string;

  @ApiPropertyOptional({
    example: 'Kelas 7',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  gradeLevel?: string;
}
