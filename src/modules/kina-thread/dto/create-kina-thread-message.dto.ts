import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatRole } from '@prisma/client';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateKinaThreadMessageDto {
  @ApiProperty({ enum: ChatRole })
  @IsEnum(ChatRole)
  role: ChatRole;

  @ApiProperty()
  @IsString()
  content: string;

  @ApiPropertyOptional({ default: 'text' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  messageType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  toolName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  toolState?: Record<string, unknown>;
}
