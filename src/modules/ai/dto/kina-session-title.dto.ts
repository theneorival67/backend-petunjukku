import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class KinaSessionTitleDto {
  @ApiProperty({ description: 'Pesan pertama guru di chat home' })
  @IsString()
  @MaxLength(2000)
  message!: string;
}

export class KinaSessionTitleResponseDto {
  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'ai_service | fallback' })
  source!: string;
}
