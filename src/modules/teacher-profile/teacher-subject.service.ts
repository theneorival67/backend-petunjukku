import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { UsersService } from '../users/users.service';
import { CreateTeacherSubjectDto } from './dto/create-teacher-subject.dto';

@Injectable()
export class TeacherSubjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private async getTeacherProfileOrThrow(user: AuthUser) {
    await this.usersService.syncSupabaseUser(user);

    const profile = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException(
        'Profil guru belum dibuat. Lengkapi profil guru terlebih dahulu.',
      );
    }

    return profile;
  }

  async findMine(user: AuthUser) {
    const profile = await this.getTeacherProfileOrThrow(user);

    return this.prisma.teacherSubject.findMany({
      where: {
        teacherProfileId: profile.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async create(user: AuthUser, dto: CreateTeacherSubjectDto) {
    const profile = await this.getTeacherProfileOrThrow(user);

    return this.prisma.teacherSubject.create({
      data: {
        teacherProfileId: profile.id,
        subjectName: dto.subjectName.trim(),
        phase: dto.phase?.trim(),
        gradeLevel: dto.gradeLevel?.trim(),
      },
    });
  }
}
