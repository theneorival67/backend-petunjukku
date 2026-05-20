import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateTeacherProfileDto } from './dto/create-teacher-profile.dto';
import { UpdateTeacherProfileDto } from './dto/update-teacher-profile.dto';

@Injectable()
export class TeacherProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(user: AuthUser) {
    const profile = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      include: { school: true },
    });
    if (!profile) {
      throw new NotFoundException('Profil guru belum dibuat');
    }
    return profile;
  }

  private async resolveSchoolId(
    schoolId?: string,
    schoolName?: string,
  ): Promise<string | undefined> {
    if (schoolId) {
      return schoolId;
    }
    const name = schoolName?.trim();
    if (!name) {
      return undefined;
    }

    const existing = await this.prisma.school.findFirst({
      where: { name },
    });
    if (existing) {
      return existing.id;
    }

    const created = await this.prisma.school.create({
      data: { name },
    });
    return created.id;
  }

  async upsert(user: AuthUser, dto: CreateTeacherProfileDto) {
    const schoolId = await this.resolveSchoolId(dto.schoolId, dto.schoolName);

    return this.prisma.teacherProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        fullName: dto.fullName.trim(),
        schoolId,
      },
      update: {
        fullName: dto.fullName.trim(),
        schoolId,
      },
      include: { school: true },
    });
  }

  async update(user: AuthUser, dto: UpdateTeacherProfileDto) {
    const existing = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
    });
    if (!existing) {
      throw new NotFoundException('Profil guru belum dibuat');
    }

    const data: { fullName?: string; schoolId?: string | null } = {};
    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName.trim();
    }
    if (dto.schoolId !== undefined || dto.schoolName !== undefined) {
      data.schoolId =
        (await this.resolveSchoolId(dto.schoolId, dto.schoolName)) ?? null;
    }

    return this.prisma.teacherProfile.update({
      where: { userId: user.id },
      data,
      include: { school: true },
    });
  }
}
