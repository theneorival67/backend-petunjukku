import { PartialType } from '@nestjs/swagger';
import { CreateTeacherProfileDto } from './create-teacher-profile.dto';

export class UpdateTeacherProfileDto extends PartialType(
  CreateTeacherProfileDto,
) {}
