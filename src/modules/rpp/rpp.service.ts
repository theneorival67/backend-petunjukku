import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RppStatus, RppType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AiGatewayService } from '../rag/ai-gateway.service';
import { UsersService } from '../users/users.service';
import { CreateRppProjectDto } from './dto/create-rpp-project.dto';
import { LintasDisiplinRecommendationResponseDto } from './dto/lintas-disiplin-recommendation.dto';
import { StageRecommendationResponseDto } from './dto/stage-recommendation.dto';
import { UpdateRppProjectDto } from './dto/update-rpp-project.dto';

@Injectable()
export class RppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly aiGateway: AiGatewayService,
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

  private toJsonObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private normalizeSubjectText(value?: string | null) {
    return (value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private fallbackLintasDisiplinSubjects(
    subject?: string | null,
    topic?: string | null,
    profilLulusan: string[] = [],
  ) {
    const context = this.normalizeSubjectText(
      `${subject ?? ''} ${topic ?? ''} ${profilLulusan.join(' ')}`,
    );
    const currentSubject = this.normalizeSubjectText(subject);
    const catalog = [
      { id: 'bahasa_indonesia', label: 'Bahasa Indonesia' },
      { id: 'informatika', label: 'Informatika' },
      { id: 'matematika', label: 'Matematika' },
      { id: 'ipas', label: 'IPAS' },
      { id: 'seni_budaya', label: 'Seni Budaya' },
      { id: 'pendidikan_pancasila', label: 'Pendidikan Pancasila' },
      { id: 'bahasa_inggris', label: 'Bahasa Inggris' },
      { id: 'prakarya', label: 'Prakarya' },
      { id: 'pjok', label: 'PJOK' },
      { id: 'ips', label: 'IPS' },
    ];
    const priority = [
      ...(context.includes('matematika') || context.includes('aljabar')
        ? ['informatika', 'bahasa_indonesia', 'seni_budaya', 'ipas', 'prakarya']
        : []),
      ...(context.includes('ipa') ||
      context.includes('biologi') ||
      context.includes('fisika') ||
      context.includes('kimia')
        ? ['matematika', 'informatika', 'bahasa_indonesia', 'prakarya', 'pjok']
        : []),
      ...(context.includes('bahasa')
        ? [
            'seni_budaya',
            'pendidikan_pancasila',
            'informatika',
            'ips',
            'bahasa_inggris',
          ]
        : []),
      ...(context.includes('kolaborasi') || context.includes('komunikasi')
        ? ['bahasa_indonesia', 'pendidikan_pancasila', 'seni_budaya']
        : []),
      'bahasa_indonesia',
      'informatika',
      'matematika',
      'seni_budaya',
      'pendidikan_pancasila',
      'ipas',
      'prakarya',
      'bahasa_inggris',
      'pjok',
      'ips',
    ];
    const picked = new Set<string>();
    const currentWords = currentSubject.split(/\s+/).filter(Boolean);

    for (const id of priority) {
      const item = catalog.find((candidate) => candidate.id === id);
      if (!item || picked.has(item.id)) {
        continue;
      }
      const label = this.normalizeSubjectText(item.label);
      if (
        currentSubject &&
        (label === currentSubject ||
          currentWords.some((word) => word.length > 3 && label.includes(word)))
      ) {
        continue;
      }
      picked.add(item.id);
      if (picked.size >= 5) {
        break;
      }
    }

    return catalog.filter((item) => picked.has(item.id)).slice(0, 5);
  }

  private toStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
    }

    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }

    return [];
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
        topic: dto.topic?.trim() || undefined,
        totalJp: dto.totalJp,
        meetingCount: dto.meetingCount,
        semester: dto.semester?.trim() || undefined,
        classConditions: dto.classConditions?.trim() || undefined,
        status: RppStatus.draft,
      },
      include: {
        school: true,
        teacherSubject: true,
        teacherClass: true,
        stages: {
          orderBy: { stageNumber: 'asc' },
        },
      },
    });
  }

  async findMine(user: AuthUser, archived = false) {
    await this.usersService.syncSupabaseUser(user);

    return this.prisma.rppProject.findMany({
      where: {
        userId: user.id,
        status: archived ? RppStatus.archived : { not: RppStatus.archived },
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
      throw new NotFoundException('Project RPM tidak ditemukan.');
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
      topic?: string | null;
      totalJp?: number | null;
      meetingCount?: number | null;
      semester?: string | null;
      classConditions?: string | null;
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

    if (dto.topic !== undefined) {
      data.topic = dto.topic?.trim() || null;
    }

    if (dto.totalJp !== undefined) {
      data.totalJp = dto.totalJp;
    }

    if (dto.meetingCount !== undefined) {
      data.meetingCount = dto.meetingCount;
    }

    if (dto.semester !== undefined) {
      data.semester = dto.semester?.trim() || null;
    }

    if (dto.classConditions !== undefined) {
      data.classConditions = dto.classConditions?.trim() || null;
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

  async remove(user: AuthUser, projectId: string) {
    const existingProject = await this.findOne(user, projectId);

    await this.prisma.rppProject.delete({
      where: {
        id: existingProject.id,
      },
    });

    return { id: existingProject.id, deleted: true };
  }

  async recommendStage(
    user: AuthUser,
    projectId: string,
    stageNumber: number,
  ): Promise<StageRecommendationResponseDto> {
    if (stageNumber !== 2) {
      throw new BadRequestException(
        'Rekomendasi AI saat ini hanya tersedia untuk stageNumber 2.',
      );
    }

    await this.usersService.syncSupabaseUser(user);

    const project = await this.prisma.rppProject.findFirst({
      where: { id: projectId, userId: user.id },
      include: {
        teacherProfile: {
          include: {
            school: {
              include: {
                environmentScans: {
                  orderBy: { fetchedAt: 'desc' },
                  take: 1,
                },
              },
            },
            subjects: true,
            classes: true,
          },
        },
        school: {
          include: {
            environmentScans: {
              orderBy: { fetchedAt: 'desc' },
              take: 1,
            },
          },
        },
        teacherSubject: true,
        teacherClass: true,
        stages: {
          orderBy: { stageNumber: 'asc' },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project RPM tidak ditemukan.');
    }

    const stage1 = project.stages.find((stage) => stage.stageNumber === 1);
    const environmentScan =
      project.school?.environmentScans?.[0] ??
      project.teacherProfile.school?.environmentScans?.[0] ??
      null;

    const recommendationType =
      project.rppType === RppType.pjbl_kokurikuler
        ? 'project_recommendation'
        : 'learning_objectives_flow';
    const targetStage = {
      stageNumber: 2,
      stageName:
        project.rppType === RppType.pjbl_kokurikuler
          ? 'Rekomendasi Proyek'
          : 'Fondasi Tujuan Pembelajaran',
      recommendationType,
      topic: project.topic || project.title,
    };

    const payload = {
      targetStageNumber: 2,
      rppType: project.rppType,
      recommendationType,
      project: {
        id: project.id,
        title: project.title,
        rppType: project.rppType,
        subject: project.subject,
        phase: project.phase,
        gradeLevel: project.gradeLevel,
        topic: project.topic,
        totalJp: project.totalJp,
        meetingCount: project.meetingCount,
        semester: project.semester,
        classConditions: project.classConditions,
        status: project.status,
      },
      teacherProfile: {
        id: project.teacherProfile.id,
        fullName: project.teacherProfile.fullName,
        position: project.teacherProfile.position,
        educationLevel: project.teacherProfile.educationLevel,
        teachingExperienceYears: project.teacherProfile.teachingExperienceYears,
        teachingContext: project.teacherProfile.teachingContext,
      },
      school: project.school
        ? {
            id: project.school.id,
            name: project.school.name,
            npsn: project.school.npsn,
            province: project.school.province,
            city: project.school.city,
            district: project.school.district,
            address: project.school.address,
            latitude: project.school.latitude,
            longitude: project.school.longitude,
            schoolLevel: project.school.schoolLevel,
            schoolType: project.school.schoolType,
            schoolEnvironment: project.school.schoolEnvironment,
            availableFacilities: this.toStringList(
              project.school.availableFacilities,
            ),
            internetAccess: project.school.internetAccess,
            localContext: project.school.localContext,
          }
        : null,
      teacherSubject: project.teacherSubject,
      teacherClass: project.teacherClass
        ? {
            id: project.teacherClass.id,
            className: project.teacherClass.className,
            gradeLevel: project.teacherClass.gradeLevel,
            academicYear: project.teacherClass.academicYear,
            studentCount: project.teacherClass.studentCount,
            studentCharacteristics:
              project.teacherClass.studentCharacteristics,
            learningChallenges: this.toStringList(
              project.teacherClass.learningChallenges,
            ),
            dominantLearningStyle: project.teacherClass.dominantLearningStyle,
          }
        : null,
      previousStages: project.stages
        .filter((stage) => stage.stageNumber < 2)
        .map((stage) => ({
          stageNumber: stage.stageNumber,
          stageName: stage.stageName,
          contentJson: this.toJsonObject(stage.contentJson),
          isCompleted: stage.isCompleted,
        })),
      targetStage,
      options: {
        topK: 5,
        language: 'id',
        outputFormat: 'json',
      },
      stage1: stage1
        ? {
            stageName: stage1.stageName,
            contentJson: this.toJsonObject(stage1.contentJson),
            isCompleted: stage1.isCompleted,
          }
        : null,
      placesContext: environmentScan
        ? {
            source: environmentScan.source,
            latitude: environmentScan.latitude,
            longitude: environmentScan.longitude,
            radiusMeters: environmentScan.radiusMeters,
            fetchedAt: environmentScan.fetchedAt,
            payload: environmentScan.payload,
          }
        : null,
    };

    return this.aiGateway.postInternal<StageRecommendationResponseDto>(
      'internal/ai/recommend-stage',
      payload,
    );
  }

  async recommendLintasDisiplin(
    user: AuthUser,
    projectId: string,
    profilLulusan: string[] = [],
  ): Promise<LintasDisiplinRecommendationResponseDto> {
    await this.usersService.syncSupabaseUser(user);

    const project = await this.prisma.rppProject.findFirst({
      where: { id: projectId, userId: user.id },
      include: {
        teacherProfile: {
          include: { school: true },
        },
        school: true,
        teacherClass: true,
        stages: {
          orderBy: { stageNumber: 'asc' },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project RPM tidak ditemukan.');
    }

    if (project.rppType !== RppType.intrakurikuler) {
      throw new BadRequestException(
        'Rekomendasi lintas disiplin saat ini hanya tersedia untuk RPM intrakurikuler.',
      );
    }

    return {
      subjects: this.fallbackLintasDisiplinSubjects(
        project.subject,
        project.topic,
        profilLulusan,
      ),
      source: 'be_fallback',
    };
  }
}
