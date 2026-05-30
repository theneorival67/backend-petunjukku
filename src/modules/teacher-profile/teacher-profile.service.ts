import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Prisma, type School } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PlacesService } from '../places/places.service';
import { UsersService } from '../users/users.service';
import { CreateTeacherProfileDto } from './dto/create-teacher-profile.dto';
import { UpdateTeacherProfileDto } from './dto/update-teacher-profile.dto';

@Injectable()
export class TeacherProfileService {
  private readonly logger = new Logger(TeacherProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => PlacesService))
    private readonly placesService: PlacesService,
  ) {}

  async findMine(user: AuthUser) {
    await this.usersService.syncSupabaseUser(user);

    let profile = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      include: {
        school: true,
        subjects: true,
        classes: true,
      },
    });

    if (profile?.school) {
      const synced = await this.ensureSchoolCoordinates(profile.school);
      if (synced !== profile.school) {
        profile = { ...profile, school: synced };
      }
    }

    return {
      profile: profile ? this.mapProfileForClient(profile) : null,
      onboardingCompleted: profile?.onboardingCompleted ?? false,
    };
  }

  private hasSchoolCoordinates(school: School): boolean {
    return (
      typeof school.latitude === 'number' &&
      typeof school.longitude === 'number'
    );
  }

  /** Isi koordinat dari Google Place ID jika belum tersimpan di tabel schools. */
  private async ensureSchoolCoordinates(school: School): Promise<School> {
    if (this.hasSchoolCoordinates(school)) {
      return school;
    }

    const placeId = school.googlePlaceId?.trim();
    if (!placeId) {
      return school;
    }

    try {
      const details = await this.placesService.getPlaceDetails(placeId);
      if (details.latitude === undefined || details.longitude === undefined) {
        return school;
      }

      return this.prisma.school.update({
        where: { id: school.id },
        data: {
          googlePlaceId: details.placeId ?? placeId,
          latitude: details.latitude,
          longitude: details.longitude,
          ...(details.address ? { address: details.address } : {}),
          ...(details.district ? { district: details.district } : {}),
          ...(details.city ? { city: details.city } : {}),
          ...(details.province ? { province: details.province } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Gagal mengambil koordinat sekolah dari Google: ${error instanceof Error ? error.message : error}`,
      );
      return school;
    }
  }

  private schoolMetaFromDto(dto: {
    schoolCity?: string;
    schoolProvince?: string;
    schoolAddress?: string;
    schoolDistrict?: string;
    schoolPlaceId?: string;
    schoolLatitude?: number;
    schoolLongitude?: number;
  }) {
    const city = dto.schoolCity?.trim();
    const province = dto.schoolProvince?.trim();
    const address = dto.schoolAddress?.trim();
    const district = dto.schoolDistrict?.trim();
    const googlePlaceId = dto.schoolPlaceId?.trim();
    const latitude = dto.schoolLatitude;
    const longitude = dto.schoolLongitude;
    if (
      !city &&
      !province &&
      !address &&
      !district &&
      !googlePlaceId &&
      latitude === undefined &&
      longitude === undefined
    ) {
      return undefined;
    }
    return {
      city,
      province,
      address,
      district,
      googlePlaceId,
      latitude,
      longitude,
    };
  }

  private schoolMetaUpdateData(meta: {
    city?: string;
    province?: string;
    address?: string;
    district?: string;
    googlePlaceId?: string;
    latitude?: number;
    longitude?: number;
  }) {
    return {
      ...(meta.city ? { city: meta.city } : {}),
      ...(meta.province ? { province: meta.province } : {}),
      ...(meta.address ? { address: meta.address } : {}),
      ...(meta.district ? { district: meta.district } : {}),
      ...(meta.googlePlaceId ? { googlePlaceId: meta.googlePlaceId } : {}),
      ...(meta.latitude !== undefined ? { latitude: meta.latitude } : {}),
      ...(meta.longitude !== undefined ? { longitude: meta.longitude } : {}),
    };
  }

  private async resolveSchoolId(
    schoolId?: string,
    schoolName?: string,
    meta?: {
      city?: string;
      province?: string;
      address?: string;
      district?: string;
      googlePlaceId?: string;
      latitude?: number;
      longitude?: number;
    },
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
      if (meta) {
        const data = this.schoolMetaUpdateData(meta);
        if (Object.keys(data).length > 0) {
          await this.prisma.school.update({
            where: { id: existing.id },
            data,
          });
        }
      }
      return existing.id;
    }

    const created = await this.prisma.school.create({
      data: {
        name,
        city: meta?.city,
        province: meta?.province,
        address: meta?.address,
        district: meta?.district,
        googlePlaceId: meta?.googlePlaceId,
        latitude: meta?.latitude,
        longitude: meta?.longitude,
      },
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
      teachingContext?: Prisma.InputJsonValue;
      onboardingCompleted?: boolean;
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

    if (dto.context !== undefined) {
      data.teachingContext = dto.context as Prisma.InputJsonValue;
      data.onboardingCompleted = true;
    }

    if (schoolId !== undefined) {
      data.schoolId = schoolId;
    }

    return data;
  }

  private mapProfileForClient<
    T extends {
      teachingContext?: unknown;
      [key: string]: unknown;
    },
  >(profile: T): T & { context: unknown } {
    const { teachingContext, ...rest } = profile;
    return {
      ...rest,
      context: teachingContext ?? null,
    } as T & { context: unknown };
  }

  private getFallbackFullName(user: AuthUser): string {
    return user.name?.trim() || user.email?.split('@')[0] || 'Guru';
  }

  async upsert(user: AuthUser, dto: CreateTeacherProfileDto) {
    await this.usersService.syncSupabaseUser(user);

    const schoolMeta = this.schoolMetaFromDto(dto);
    const schoolId = await this.resolveSchoolId(
      dto.schoolId,
      dto.schoolName,
      schoolMeta,
    );
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
      profile: this.mapProfileForClient(profile),
      onboardingCompleted: profile.onboardingCompleted,
    };
  }

  async update(user: AuthUser, dto: UpdateTeacherProfileDto) {
    await this.usersService.syncSupabaseUser(user);

    const existing = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
    });

    let schoolId: string | null | undefined;

    if (
      dto.schoolId !== undefined ||
      dto.schoolName !== undefined ||
      dto.schoolCity !== undefined ||
      dto.schoolProvince !== undefined ||
      dto.schoolAddress !== undefined ||
      dto.schoolDistrict !== undefined ||
      dto.schoolPlaceId !== undefined ||
      dto.schoolLatitude !== undefined ||
      dto.schoolLongitude !== undefined
    ) {
      const schoolMeta = this.schoolMetaFromDto(dto);
      schoolId =
        (await this.resolveSchoolId(
          dto.schoolId,
          dto.schoolName,
          schoolMeta,
        )) ?? null;
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
        profile: this.mapProfileForClient(profile),
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
      profile: this.mapProfileForClient(profile),
      onboardingCompleted: profile.onboardingCompleted,
    };
  }
}
