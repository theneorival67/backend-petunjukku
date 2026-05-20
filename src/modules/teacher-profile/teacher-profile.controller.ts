import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateTeacherProfileDto } from './dto/create-teacher-profile.dto';
import { UpdateTeacherProfileDto } from './dto/update-teacher-profile.dto';
import { TeacherProfileService } from './teacher-profile.service';

@Controller('teacher-profile')
export class TeacherProfileController {
  constructor(private readonly teacherProfileService: TeacherProfileService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.teacherProfileService.findMine(user);
  }

  @Post()
  upsert(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTeacherProfileDto,
  ) {
    return this.teacherProfileService.upsert(user, dto);
  }

  @Patch('me')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTeacherProfileDto,
  ) {
    return this.teacherProfileService.update(user, dto);
  }
}
