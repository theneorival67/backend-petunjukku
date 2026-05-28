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
  @ApiProperty({ type: KinaChatMessageDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => KinaChatMessageDto)
  messages!: KinaChatMessageDto[];
}

export class KinaChatResponseDto {
  @ApiProperty()
  reply!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty({ description: 'opencode_go | fallback' })
  source!: string;
}
