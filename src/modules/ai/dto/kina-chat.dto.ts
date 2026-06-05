import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class KinaChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class KinaChatDto {
  @ApiPropertyOptional({
    description:
      'Project RPP yang sedang dibahas. Jika dikirim, backend memvalidasi project milik user login dan menambahkan konteks project.',
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description:
      'Pesan tunggal dari frontend. Tetap kompatibel dengan messages[] yang sudah berjalan.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  @ApiProperty({ type: KinaChatMessageDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => KinaChatMessageDto)
  messages?: KinaChatMessageDto[];
}

export class KinaChatResponseDto {
  @ApiProperty()
  reply!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty({ description: 'ai_service | fallback' })
  source!: string;

  @ApiPropertyOptional({ type: [Object] })
  usedReferences?: unknown[];

  @ApiPropertyOptional({ type: [String] })
  suggestedFollowUpQuestions?: string[];
}
