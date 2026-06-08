import { ApiProperty } from '@nestjs/swagger';

export class LintasDisiplinOptionDto {
  @ApiProperty({ example: 'fisika' })
  id!: string;

  @ApiProperty({ example: 'Fisika' })
  label!: string;
}

export class LintasDisiplinRecommendationResponseDto {
  @ApiProperty({ type: [LintasDisiplinOptionDto] })
  subjects!: LintasDisiplinOptionDto[];

  @ApiProperty({ example: 'openai/gpt-4o-mini', required: false })
  model?: string;

  @ApiProperty({ example: 'ai_service' })
  source!: string;
}
