import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RppStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateRppProjectDto } from './create-rpp-project.dto';

export class UpdateRppProjectDto extends PartialType(CreateRppProjectDto) {
  @ApiPropertyOptional({
    enum: RppStatus,
    example: RppStatus.in_progress,
  })
  @IsOptional()
  @IsEnum(RppStatus)
  status?: RppStatus;
}
