import { ApiProperty } from '@nestjs/swagger';

export class StageRecommendationResponseDto {
  @ApiProperty({ example: 'intrakurikuler' })
  rppType!: string;

  @ApiProperty({
    example: 'learning_objectives_flow',
    description:
      'learning_objectives_flow untuk intrakurikuler, project_recommendation untuk pjbl_kokurikuler.',
  })
  recommendationType!: string;

  @ApiProperty({ example: 2 })
  targetStageNumber!: number;

  @ApiProperty({ type: Object, required: false })
  ragReferences?: unknown[];

  @ApiProperty({ type: Object })
  recommendations!: Record<string, unknown>;
}
