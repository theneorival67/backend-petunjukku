import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateTeacherProfileDto } from './dto/create-teacher-profile.dto';
import { UpdateTeacherProfileDto } from './dto/update-teacher-profile.dto';
import { TeacherProfileService } from './teacher-profile.service';

@ApiTags('teacher-profile')
@ApiBearerAuth('supabase')
@Controller('teacher-profile')
export class TeacherProfileController {
  constructor(private readonly teacherProfileService: TeacherProfileService) {}

  @ApiOperation({ summary: 'Ambil profil guru milik user login' })
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.teacherProfileService.findMine(user);
  }

  @ApiOperation({ summary: 'Buat atau ganti profil guru milik user login' })
  @Post()
  upsert(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTeacherProfileDto,
  ) {
    return this.teacherProfileService.upsert(user, dto);
  }

  @ApiOperation({ summary: 'Update sebagian profil guru milik user login' })
  @Patch('me')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTeacherProfileDto,
  ) {
    return this.teacherProfileService.update(user, dto);
  }
}
