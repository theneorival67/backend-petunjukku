import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTeacherSubjectDto {
  @ApiProperty({
    example: 'IPA',
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  subjectName: string;

  @ApiPropertyOptional({
    example: 'Fase D',
    description: 'Contoh: Fase A, Fase B, Fase C, Fase D, Fase E, Fase F',
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
