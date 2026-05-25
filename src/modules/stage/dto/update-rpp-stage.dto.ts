import { PartialType } from '@nestjs/swagger';
import { SaveRppStageDto } from './save-rpp-stage.dto';

export class UpdateRppStageDto extends PartialType(SaveRppStageDto) {}
