import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { UsersService } from '../users/users.service';
import { CreateTeacherProfileDto } from './dto/create-teacher-profile.dto';
import { UpdateTeacherProfileDto } from './dto/update-teacher-profile.dto';

@Injectable()
export class TeacherProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async findMine(user: AuthUser) {
    await this.usersService.syncSupabaseUser(user);

    const profile = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      include: {
        school: true,
        subjects: true,
        classes: true,
      },
    });

    return {
      profile,
      onboardingCompleted: profile?.onboardingCompleted ?? false,
    };
  }

  private async resolveSchoolId(
    schoolId?: string,
    schoolName?: string,
  ): Promise<string | undefined> {
    if (schoolId) {
      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
      });

      if (!school) {
        throw new NotFoundException('Sekolah tidak ditemukan.');
      }

      return school.id;
    }

    const name = schoolName?.trim();
    if (!name) {
      return undefined;
    }

    const existing = await this.prisma.school.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
      },
    });

    if (existing) {
      return existing.id;
    }

    const created = await this.prisma.school.create({
      data: { name },
    });

    return created.id;
  }

  private buildProfileData(
    dto: CreateTeacherProfileDto | UpdateTeacherProfileDto,
    schoolId?: string | null,
  ) {
    const data: {
      fullName?: string;
      phone?: string;
      position?: string;
      educationLevel?: string;
      teachingExperienceYears?: number;
      bio?: string;
      schoolId?: string | null;
    } = {};

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName.trim();
    }

    if (dto.phone !== undefined) {
      data.phone = dto.phone.trim();
    }

    if (dto.position !== undefined) {
      data.position = dto.position.trim();
    }

    if (dto.educationLevel !== undefined) {
      data.educationLevel = dto.educationLevel.trim();
    }

    if (dto.teachingExperienceYears !== undefined) {
      data.teachingExperienceYears = dto.teachingExperienceYears;
    }

    if (dto.bio !== undefined) {
      data.bio = dto.bio.trim();
    }

    if (schoolId !== undefined) {
      data.schoolId = schoolId;
    }

    return data;
  }

  private getFallbackFullName(user: AuthUser): string {
    return user.name?.trim() || user.email?.split('@')[0] || 'Guru';
  }

  async upsert(user: AuthUser, dto: CreateTeacherProfileDto) {
    await this.usersService.syncSupabaseUser(user);

    const schoolId = await this.resolveSchoolId(dto.schoolId, dto.schoolName);
    const profileData = this.buildProfileData(dto, schoolId);

    const profile = await this.prisma.teacherProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...profileData,
        fullName: dto.fullName.trim(),
      },
      update: profileData,
      include: {
        school: true,
        subjects: true,
        classes: true,
      },
    });

    return {
      message: 'Profil guru berhasil disimpan.',
      profile,
      onboardingCompleted: profile.onboardingCompleted,
    };
  }

  async update(user: AuthUser, dto: UpdateTeacherProfileDto) {
    await this.usersService.syncSupabaseUser(user);

    const existing = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
    });

    let schoolId: string | null | undefined;

    if (dto.schoolId !== undefined || dto.schoolName !== undefined) {
      schoolId =
        (await this.resolveSchoolId(dto.schoolId, dto.schoolName)) ?? null;
    }

    const data = this.buildProfileData(dto, schoolId);

    if (!existing) {
      const profile = await this.prisma.teacherProfile.create({
        data: {
          userId: user.id,
          ...data,
          fullName: dto.fullName?.trim() ?? this.getFallbackFullName(user),
        },
        include: {
          school: true,
          subjects: true,
          classes: true,
        },
      });

      return {
        message: 'Profil guru berhasil dibuat.',
        profile,
        onboardingCompleted: profile.onboardingCompleted,
      };
    }

    const profile = await this.prisma.teacherProfile.update({
      where: { userId: user.id },
      data,
      include: {
        school: true,
        subjects: true,
        classes: true,
      },
    });

    return {
      message: 'Profil guru berhasil diperbarui.',
      profile,
      onboardingCompleted: profile.onboardingCompleted,
    };
  }
}
