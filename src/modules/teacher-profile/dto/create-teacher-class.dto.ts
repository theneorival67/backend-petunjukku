import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTeacherClassDto {
  @ApiProperty({
    example: '7A',
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  className: string;

  @ApiProperty({
    example: 'Kelas 7',
    maxLength: 50,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  gradeLevel: string;

  @ApiPropertyOptional({
    example: '2025/2026',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  academicYear?: string;

  @ApiPropertyOptional({
    example: 32,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  studentCount?: number;

  @ApiPropertyOptional({
    example:
      'Siswa aktif, suka kegiatan praktik, tetapi kemampuan literasi beragam.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  studentCharacteristics?: string;

  @ApiPropertyOptional({
    example: [
      'Sebagian siswa kurang percaya diri presentasi',
      'Kemampuan literasi membaca masih beragam',
    ],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  learningChallenges?: string[];

  @ApiPropertyOptional({
    example: 'visual dan praktik',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  dominantLearningStyle?: string;
}
