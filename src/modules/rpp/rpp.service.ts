import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RppStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { UsersService } from '../users/users.service';
import { CreateRppProjectDto } from './dto/create-rpp-project.dto';
import { UpdateRppProjectDto } from './dto/update-rpp-project.dto';

@Injectable()
export class RppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private async getTeacherProfileOrThrow(user: AuthUser) {
    await this.usersService.syncSupabaseUser(user);

    const profile = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
      include: {
        school: true,
      },
    });

    if (!profile) {
      throw new NotFoundException(
        'Profil guru belum dibuat. Lengkapi profil guru terlebih dahulu.',
      );
    }

    return profile;
  }

  private async resolveTeacherSubject(
    teacherProfileId: string,
    teacherSubjectId?: string,
  ) {
    if (!teacherSubjectId) {
      return null;
    }

    const subject = await this.prisma.teacherSubject.findFirst({
      where: {
        id: teacherSubjectId,
        teacherProfileId,
      },
    });

    if (!subject) {
      throw new NotFoundException(
        'Mapel guru tidak ditemukan atau bukan milik user login.',
      );
    }

    return subject;
  }

  private async resolveTeacherClass(
    teacherProfileId: string,
    teacherClassId?: string,
  ) {
    if (!teacherClassId) {
      return null;
    }

    const teacherClass = await this.prisma.teacherClass.findFirst({
      where: {
        id: teacherClassId,
        teacherProfileId,
      },
    });

    if (!teacherClass) {
      throw new NotFoundException(
        'Kelas guru tidak ditemukan atau bukan milik user login.',
      );
    }

    return teacherClass;
  }

  async create(user: AuthUser, dto: CreateRppProjectDto) {
    const profile = await this.getTeacherProfileOrThrow(user);

    const teacherSubject = await this.resolveTeacherSubject(
      profile.id,
      dto.teacherSubjectId,
    );

    const teacherClass = await this.resolveTeacherClass(
      profile.id,
      dto.teacherClassId,
    );

    const subject = dto.subject?.trim() || teacherSubject?.subjectName;
    const phase = dto.phase?.trim() || teacherSubject?.phase || undefined;
    const gradeLevel =
      dto.gradeLevel?.trim() ||
      teacherClass?.gradeLevel ||
      teacherSubject?.gradeLevel ||
      undefined;

    if (!subject) {
      throw new BadRequestException(
        'Subject wajib diisi jika teacherSubjectId tidak dikirim.',
      );
    }

    return this.prisma.rppProject.create({
      data: {
        userId: user.id,
        teacherProfileId: profile.id,
        schoolId: profile.schoolId,
        teacherSubjectId: teacherSubject?.id,
        teacherClassId: teacherClass?.id,
        title: dto.title.trim(),
        rppType: dto.rppType,
        subject,
        phase,
        gradeLevel,
        status: RppStatus.draft,
      },
      include: {
        school: true,
        teacherSubject: true,
        teacherClass: true,
        stages: true,
      },
    });
  }

  async findMine(user: AuthUser) {
    await this.usersService.syncSupabaseUser(user);

    return this.prisma.rppProject.findMany({
      where: {
        userId: user.id,
        status: {
          not: RppStatus.archived,
        },
      },
      include: {
        school: true,
        teacherSubject: true,
        teacherClass: true,
        _count: {
          select: {
            stages: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async findOne(user: AuthUser, projectId: string) {
    await this.usersService.syncSupabaseUser(user);

    const project = await this.prisma.rppProject.findFirst({
      where: {
        id: projectId,
        userId: user.id,
      },
      include: {
        school: true,
        teacherSubject: true,
        teacherClass: true,
        stages: {
          orderBy: {
            stageNumber: 'asc',
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project RPP tidak ditemukan.');
    }

    return project;
  }

  async update(user: AuthUser, projectId: string, dto: UpdateRppProjectDto) {
    const existingProject = await this.findOne(user, projectId);

    const profile = await this.getTeacherProfileOrThrow(user);

    const teacherSubject = await this.resolveTeacherSubject(
      profile.id,
      dto.teacherSubjectId,
    );

    const teacherClass = await this.resolveTeacherClass(
      profile.id,
      dto.teacherClassId,
    );

    const data: {
      title?: string;
      rppType?: CreateRppProjectDto['rppType'];
      subject?: string;
      phase?: string | null;
      gradeLevel?: string | null;
      status?: RppStatus;
      teacherSubjectId?: string | null;
      teacherClassId?: string | null;
    } = {};

    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }

    if (dto.rppType !== undefined) {
      data.rppType = dto.rppType;
    }

    if (dto.teacherSubjectId !== undefined) {
      data.teacherSubjectId = teacherSubject?.id ?? null;
    }

    if (dto.teacherClassId !== undefined) {
      data.teacherClassId = teacherClass?.id ?? null;
    }

    if (dto.subject !== undefined) {
      data.subject = dto.subject.trim();
    } else if (teacherSubject) {
      data.subject = teacherSubject.subjectName;
    }

    if (dto.phase !== undefined) {
      data.phase = dto.phase?.trim() || null;
    } else if (teacherSubject?.phase) {
      data.phase = teacherSubject.phase;
    }

    if (dto.gradeLevel !== undefined) {
      data.gradeLevel = dto.gradeLevel?.trim() || null;
    } else if (teacherClass?.gradeLevel || teacherSubject?.gradeLevel) {
      data.gradeLevel =
        teacherClass?.gradeLevel || teacherSubject?.gradeLevel || null;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    return this.prisma.rppProject.update({
      where: {
        id: existingProject.id,
      },
      data,
      include: {
        school: true,
        teacherSubject: true,
        teacherClass: true,
        stages: {
          orderBy: {
            stageNumber: 'asc',
          },
        },
      },
    });
  }

  async archive(user: AuthUser, projectId: string) {
    const existingProject = await this.findOne(user, projectId);

    return this.prisma.rppProject.update({
      where: {
        id: existingProject.id,
      },
      data: {
        status: RppStatus.archived,
      },
    });
  }
}
