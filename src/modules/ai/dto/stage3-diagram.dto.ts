import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class Stage3DiagramDto {
  @ApiProperty({
    description: 'Input Stage 3 yang sudah dikunci dari dashboard.',
  })
  @IsObject()
  stage3Inputs!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Opsi tambahan untuk generator diagram.',
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}
