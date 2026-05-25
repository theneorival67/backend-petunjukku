import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class SaveRppStageDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Nomor stage RPP. Contoh: 1, 2, 3, 4, 5',
  })
  @IsInt()
  @Min(1)
  stageNumber: number;

  @ApiProperty({
    example: 'Konteks Dasar Pembelajaran',
    maxLength: 120,
  })
  @IsString()
  @MaxLength(120)
  stageName: string;

  @ApiProperty({
    example: {
      educationLevel: 'SMP',
      phase: 'Fase D',
      subject: 'IPA',
      gradeLevel: 'Kelas 7',
      topic: 'Sistem Pencernaan Manusia',
    },
    description: 'Isi data stage dalam bentuk JSON fleksibel',
  })
  @IsObject()
  contentJson: Record<string, unknown>;

  @ApiPropertyOptional({
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;
}
