import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateTeacherClassDto } from './dto/create-teacher-class.dto';
import { CreateTeacherProfileDto } from './dto/create-teacher-profile.dto';
import { CreateTeacherSubjectDto } from './dto/create-teacher-subject.dto';
import { UpdateTeacherProfileDto } from './dto/update-teacher-profile.dto';
import { TeacherClassService } from './teacher-class.service';
import { TeacherProfileService } from './teacher-profile.service';
import { TeacherSubjectService } from './teacher-subject.service';

@ApiTags('teacher-profile')
@ApiBearerAuth('supabase')
@Controller('teacher-profile')
export class TeacherProfileController {
  constructor(
    private readonly teacherProfileService: TeacherProfileService,
    private readonly teacherSubjectService: TeacherSubjectService,
    private readonly teacherClassService: TeacherClassService,
  ) {}

  @ApiOperation({ summary: 'Ambil profil guru milik user login' })
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.teacherProfileService.findMine(user);
  }

  @ApiOperation({ summary: 'Buat atau perbarui profil guru milik user login' })
  @Post()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: CreateTeacherProfileDto) {
    return this.teacherProfileService.upsert(user, dto);
  }

  @ApiOperation({ summary: 'Update sebagian profil guru milik user login' })
  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateTeacherProfileDto) {
    return this.teacherProfileService.update(user, dto);
  }

  @ApiOperation({ summary: 'Ambil daftar mapel yang diajar guru login' })
  @Get('subjects')
  getSubjects(@CurrentUser() user: AuthUser) {
    return this.teacherSubjectService.findMine(user);
  }

  @ApiOperation({ summary: 'Tambah mapel yang diajar guru login' })
  @Post('subjects')
  createSubject(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTeacherSubjectDto,
  ) {
    return this.teacherSubjectService.create(user, dto);
  }

  @ApiOperation({ summary: 'Ambil daftar kelas yang diajar guru login' })
  @Get('classes')
  getClasses(@CurrentUser() user: AuthUser) {
    return this.teacherClassService.findMine(user);
  }

  @ApiOperation({ summary: 'Tambah kelas yang diajar guru login' })
  @Post('classes')
  createClass(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTeacherClassDto,
  ) {
    return this.teacherClassService.create(user, dto);
  }
}
