import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { UsersService } from '../users/users.service';
import { CreateTeacherClassDto } from './dto/create-teacher-class.dto';

@Injectable()
export class TeacherClassService {
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

    return this.prisma.teacherClass.findMany({
      where: {
        teacherProfileId: profile.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async create(user: AuthUser, dto: CreateTeacherClassDto) {
    const profile = await this.getTeacherProfileOrThrow(user);

    return this.prisma.teacherClass.create({
      data: {
        teacherProfileId: profile.id,
        className: dto.className.trim(),
        gradeLevel: dto.gradeLevel.trim(),
        academicYear: dto.academicYear?.trim(),
        studentCount: dto.studentCount,
        studentCharacteristics: dto.studentCharacteristics?.trim(),
        learningChallenges: dto.learningChallenges ?? undefined,
        dominantLearningStyle: dto.dominantLearningStyle?.trim(),
      },
    });
  }
}
