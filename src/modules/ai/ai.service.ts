import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RppStatus } from '@prisma/client';

import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../rag/ai-gateway.service';
import type { KinaChatDto, KinaChatMessageDto } from './dto/kina-chat.dto';
import type { Stage3DiagramDto } from './dto/stage3-diagram.dto';
import {
  ENVIRONMENT_CANDIDATE_LIMIT,
  buildNearbyPlaceCandidates,
  curateNearbyPlaces,
  formatDistanceLabel,
  type CuratedNearbyPlace,
  type NearbyPlaceCandidate,
  type RawNearbyPlace,
} from '../places/environment-curate';
import type { AiEnvironmentResponseJson } from './ai-environment.types';

type GenerateRppFastApiResponse = {
  contentJson?: Record<string, unknown>;
  contentMarkdown?: string;
  usedReferences?: unknown[];
  model?: string;
};

type KinaSummaryFastApiResponse = {
  summary?: Record<string, unknown>;
};

type KinaChatProgress = {
  activeStage?: string;
  activeLabel?: string;
  completedCount?: number;
  totalCount?: number;
  percentage?: number;
  isComplete?: boolean;
  missingSlots?: string[];
  stages?: {
    key: string;
    label: string;
    complete: boolean;
    foundSlots?: string[];
    missingSlots?: string[];
  }[];
};

type KinaFastApiResponse = {
  reply?: string;
  model?: string;
  usedReferences?: unknown[];
  suggestedFollowUpQuestions?: string[];
  progress?: KinaChatProgress;
};

const ALLOWED_COLOR_KEYS = new Set([
  'emerald',
  'amber',
  'blue',
  'violet',
  'rose',
  'slate',
  'cyan',
  'gray',
]);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly aiGateway: AiGatewayService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isEnabled(): boolean {
    const cfg = this.configService.get('ai', { infer: true })!;
    return Boolean(cfg.enabled && cfg.aiServiceBaseUrl);
  }

  status() {
    const cfg = this.configService.get('ai', { infer: true })!;

    return {
      enabled: this.isEnabled(),
      configured: Boolean(cfg.aiServiceBaseUrl),
      baseUrl: cfg.aiServiceBaseUrl,
      gateway: 'fastapi_internal',
    };
  }

  async suggestSessionTitle(message: string): Promise<{
    title: string;
    source: 'ai_service' | 'fallback';
  }> {
    const cleaned = message.trim().slice(0, 2000);
    const fallback = this.fallbackSessionTitle(cleaned);

    if (!cleaned) {
      return { title: 'Percakapan baru', source: 'fallback' };
    }

    if (!this.isEnabled()) {
      return { title: fallback, source: 'fallback' };
    }

    try {
      const parsed = await this.aiGateway.postInternal<{
        title?: string;
      }>('internal/ai/kina/session-title', { message: cleaned });

      return {
        title: this.normalizeSessionTitle(parsed.title, fallback),
        source: 'ai_service',
      };
    } catch (error) {
      this.logger.warn(
        `Judul sesi AI gagal: ${error instanceof Error ? error.message : error}`,
      );
      return { title: fallback, source: 'fallback' };
    }
  }

  private fallbackSessionTitle(message: string): string {
    let t = message.replace(/\s+/g, ' ').trim();
    t = t.replace(
      /^(halo|hai|hei|pagi|siang|sore|malam|selamat\s+\w+|assalamualaikum)[,!\s]+/i,
      '',
    );
    t = t.replace(/^(tolong|bantu|mohon)\s+/i, '');
    t = t.trim();
    if (!t) {
      t = message.replace(/\s+/g, ' ').trim();
    }
    if (t.length > 56) {
      const cut = t.slice(0, 56);
      const lastSpace = cut.lastIndexOf(' ');
      t = lastSpace > 20 ? `${cut.slice(0, lastSpace)}…` : `${cut}…`;
    }
    return t || 'Percakapan baru';
  }

  private normalizeSessionTitle(
    raw: string | undefined,
    fallback: string,
  ): string {
    let t = raw?.trim().replace(/^["']|["']$/g, '') ?? '';
    if (
      !t ||
      t.length < 3 ||
      /rpp\s+(intrakurikuler|kokurikuler)\s+baru/i.test(t)
    ) {
      return fallback;
    }
    if (t.length > 60) {
      const cut = t.slice(0, 57);
      const lastSpace = cut.lastIndexOf(' ');
      t = lastSpace > 20 ? `${cut.slice(0, lastSpace)}…` : `${cut}…`;
    }
    return t;
  }

  async kinaChat(
    user: AuthUser,
    dto: KinaChatDto | KinaChatMessageDto[],
  ): Promise<{
    reply: string;
    model: string;
    source: 'ai_service' | 'fallback';
    usedReferences?: unknown[];
    suggestedFollowUpQuestions?: string[];
    progress?: KinaChatProgress;
  }> {
    const projectId = Array.isArray(dto) ? undefined : dto.projectId;
    const requireAi = !Array.isArray(dto) && Boolean(dto.requireAi);
    const suppliedMessages = Array.isArray(dto) ? dto : (dto.messages ?? []);
    const trimmed = suppliedMessages
      .filter((m) => m.content?.trim())
      .slice(-20)
      .map((m) => ({
        role: m.role,
        content: m.content.trim().slice(0, 4000),
      }));
    const latestFromMessages = trimmed
      .filter((message) => message.role === 'user')
      .at(-1);
    const explicitMessage = Array.isArray(dto)
      ? undefined
      : dto.message?.trim();
    const latestUserContent = (
      explicitMessage ||
      latestFromMessages?.content ||
      ''
    ).slice(0, 4000);

    if (!projectId && !latestUserContent) {
      return {
        reply:
          'Silakan tulis pertanyaan Anda—saya siap membantu merencanakan pembelajaran.',
        model: 'fallback',
        source: 'fallback',
      };
    }

    if (projectId) {
      await this.assertProjectOwner(user, projectId);
    }

    if (latestUserContent) {
      await this.prisma.kinaChat.create({
        data: {
          userId: user.id,
          rppProjectId: projectId,
          role: 'user',
          content: latestUserContent,
        },
      });
    }

    const fastApiPayload = projectId
      ? await this.buildKinaFastApiPayload(
          user,
          projectId,
          await this.getLatestKinaHistory(user.id, projectId),
        )
      : null;
    if (!this.isEnabled()) {
      if (projectId || requireAi) {
        throw new BadRequestException(
          'Layanan AI belum aktif. KINA tidak boleh memakai fallback untuk request ini.',
        );
      }
      const fallback = {
        reply: this.fallbackKinaReply(latestUserContent),
        model: 'fallback',
        source: 'fallback' as const,
      };
      await this.saveAssistantReply(user.id, projectId, fallback);
      return fallback;
    }

    if (!fastApiPayload) {
      if (requireAi) {
        throw new BadRequestException(
          'Project RPM wajib tersedia untuk memanggil KINA AI.',
        );
      }
      return {
        reply: this.fallbackKinaReply(latestUserContent),
        model: 'fallback',
        source: 'fallback',
      };
    }

    try {
      const chatHistory = Array.isArray(fastApiPayload.chatHistory)
        ? fastApiPayload.chatHistory
        : [];
      this.logger.debug(
        `KINA FastAPI request: message="${this.toLogSnippet(
          latestUserContent,
        )}", chatHistory=${chatHistory.length}`,
      );

      const response = await this.aiGateway.postInternal<KinaFastApiResponse>(
        'internal/ai/kina-chat',
        {
          ...fastApiPayload,
          message: latestUserContent,
          requireAi,
        },
      );

      if (!response.reply?.trim()) {
        throw new Error('KINA AI mengembalikan respons kosong.');
      }

      const suggestedFollowUpQuestions = this.normalizeSuggestionList(
        response.suggestedFollowUpQuestions,
      );
      this.logger.debug(
        `KINA FastAPI response: progress=${response.progress?.percentage ?? 'n/a'}, suggestedFollowUpQuestions=${JSON.stringify(
          suggestedFollowUpQuestions,
        )}`,
      );

      const result = {
        reply: response.reply.trim(),
        model: response.model ?? 'fastapi',
        source: 'ai_service' as const,
        usedReferences: response.usedReferences ?? [],
        suggestedFollowUpQuestions,
        progress: response.progress,
      };

      await this.saveAssistantReply(user.id, projectId, {
        reply: result.reply,
        model: result.model,
        source: result.source,
        metadata: {
          usedReferences: result.usedReferences,
          suggestedFollowUpQuestions: result.suggestedFollowUpQuestions,
          progress: result.progress,
        },
      });

      return result;
    } catch (error) {
      this.logger.warn(
        `KINA chat gagal: ${error instanceof Error ? error.message : error}`,
      );
      throw new BadRequestException(
        'KINA AI belum berhasil merespons. Periksa konfigurasi AI dan coba lagi.',
      );
    }
  }

  async kinaHistory(user: AuthUser, projectId: string) {
    const project = await this.prisma.rppProject.findFirst({
      where: { id: projectId, userId: user.id },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException('Project RPM tidak ditemukan.');
    }

    const messages = await this.prisma.kinaChat.findMany({
      where: {
        userId: user.id,
        rppProjectId: projectId,
      },
      orderBy: { createdAt: 'asc' },
    });

    const latestAssistantState = this.getLatestAssistantTurnState(messages);

    return {
      messages,
      suggestedFollowUpQuestions:
        latestAssistantState.suggestedFollowUpQuestions,
      progress: latestAssistantState.progress,
    };
  }

  async clearKinaHistory(user: AuthUser, projectId: string) {
    await this.assertProjectOwner(user, projectId);
    const result = await this.prisma.kinaChat.deleteMany({
      where: {
        userId: user.id,
        rppProjectId: projectId,
      },
    });
    return { deleted: result.count };
  }

  async generateStage3Diagrams(
    user: AuthUser,
    projectId: string,
    dto: Stage3DiagramDto,
  ) {
    await this.assertProjectOwner(user, projectId);

    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Layanan AI belum aktif. Diagram Stage 3 tidak bisa dibuat tanpa AI.',
      );
    }

    const history = await this.prisma.kinaChat.findMany({
      where: {
        userId: user.id,
        rppProjectId: projectId,
      },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });
    const fastApiPayload = await this.buildKinaFastApiPayload(
      user,
      projectId,
      history.map((chat) => ({ role: chat.role, content: chat.content })),
    );

    try {
      return await this.aiGateway.postInternal(
        'internal/ai/generate-stage3-diagrams',
        {
          ...fastApiPayload,
          stage3Inputs: dto.stage3Inputs,
          options: dto.options ?? {},
        },
      );
    } catch (error) {
      this.logger.warn(
        `Generate diagram Stage 3 gagal: ${
          error instanceof Error ? error.message : error
        }`,
      );
      throw new BadRequestException(
        'AI belum berhasil membuat diagram Stage 3. Periksa konfigurasi AI dan coba lagi.',
      );
    }
  }

  private async saveAssistantReply(
    userId: string,
    projectId: string | undefined,
    result: {
      reply: string;
      model: string;
      source: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.prisma.kinaChat.create({
      data: {
        userId,
        rppProjectId: projectId,
        role: 'assistant',
        content: result.reply,
        metadata: {
          model: result.model,
          source: result.source,
          ...(result.metadata ?? {}),
        },
      },
    });
  }

  private async getLatestKinaHistory(userId: string, projectId: string) {
    return (
      await this.prisma.kinaChat.findMany({
        where: {
          userId,
          rppProjectId: projectId,
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      })
    )
      .reverse()
      .map((chat) => ({
        role: chat.role,
        content: chat.content,
      }));
  }

  private normalizeSuggestionList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }

  private getLatestAssistantTurnState(
    messages: Array<{ role: string; metadata: unknown }>,
  ): {
    suggestedFollowUpQuestions: string[];
    progress?: KinaChatProgress;
  } {
    const latestMessage = messages.at(-1);

    if (latestMessage?.role !== 'assistant') {
      return { suggestedFollowUpQuestions: [] };
    }

    const metadata = this.toJsonObject(latestMessage.metadata);

    return {
      suggestedFollowUpQuestions: this.normalizeSuggestionList(
        metadata.suggestedFollowUpQuestions,
      ),
      progress:
        metadata.progress && typeof metadata.progress === 'object'
          ? (metadata.progress as KinaChatProgress)
          : undefined,
    };
  }

  private toLogSnippet(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  private toJsonObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
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

  private async buildKinaFastApiPayload(
    user: AuthUser,
    projectId: string,
    history: Array<{ role: string; content: string }>,
  ): Promise<Record<string, unknown>> {
    const project = await this.prisma.rppProject.findFirst({
      where: { id: projectId, userId: user.id },
      include: {
        teacherProfile: {
          include: { school: true },
        },
        school: true,
        teacherSubject: true,
        teacherClass: true,
        stages: { orderBy: { stageNumber: 'asc' } },
      },
    });

    if (!project) {
      throw new NotFoundException('Project RPM tidak ditemukan.');
    }

    const school = project.school ?? project.teacherProfile.school;
    const teachingContext = this.toJsonObject(
      project.teacherProfile.teachingContext,
    );
    const identityContext = this.toJsonObject(teachingContext.identity);
    const teacherGender =
      typeof identityContext.gender === 'string'
        ? identityContext.gender.trim()
        : undefined;
    const teacherFirstName =
      project.teacherProfile.fullName.trim().split(/\s+/)[0] ||
      project.teacherProfile.fullName;
    const teacherSalutationName =
      teacherGender?.toLowerCase() === 'perempuan'
        ? `Ibu ${teacherFirstName}`
        : teacherGender?.toLowerCase() === 'laki-laki'
          ? `Bapak ${teacherFirstName}`
          : teacherFirstName;
    const sanitizeLegacyTeacherName = (content: string) =>
      content
        .replace(/\b(?:Ibu|Bapak|Bu|Pak)\s+Vica\b/g, teacherSalutationName)
        .replace(/\bVica\b/g, teacherFirstName);

    return {
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
        teacherName: project.teacherProfile.fullName,
        schoolName: school?.name,
        className: project.teacherClass?.className,
      },
      teacherProfile: {
        fullName: project.teacherProfile.fullName,
        gender: teacherGender || undefined,
        position: project.teacherProfile.position,
        educationLevel: project.teacherProfile.educationLevel,
        teachingExperienceYears: project.teacherProfile.teachingExperienceYears,
      },
      school: school
        ? {
            name: school.name,
            province: school.province,
            city: school.city,
            district: school.district,
            address: school.address,
            schoolEnvironment: school.schoolEnvironment,
            availableFacilities: this.toStringList(school.availableFacilities),
            localContext: school.localContext,
          }
        : {},
      teacherSubject: project.teacherSubject
        ? {
            subjectName: project.teacherSubject.subjectName,
            phase: project.teacherSubject.phase,
            gradeLevel: project.teacherSubject.gradeLevel,
          }
        : {},
      teacherClass: project.teacherClass
        ? {
            className: project.teacherClass.className,
            gradeLevel: project.teacherClass.gradeLevel,
            studentCount: project.teacherClass.studentCount,
            studentCharacteristics: project.teacherClass.studentCharacteristics,
            learningChallenges: this.toStringList(
              project.teacherClass.learningChallenges,
            ),
            dominantLearningStyle: project.teacherClass.dominantLearningStyle,
          }
        : {},
      stages: project.stages
        .map((stage) => this.toKinaStagePayload(stage))
        .filter((stage): stage is NonNullable<typeof stage> => Boolean(stage)),
      chatHistory: history.map((chat) => ({
        role: chat.role,
        message: sanitizeLegacyTeacherName(chat.content),
      })),
    };
  }

  private toKinaStagePayload(stage: {
    stageNumber: number;
    stageName: string;
    contentJson: unknown;
    isCompleted?: boolean;
  }): {
    stageNumber: number;
    stageName: string;
    contentJson: Record<string, unknown>;
    isCompleted?: boolean;
  } | null {
    const contentJson = this.toJsonObject(stage.contentJson);

    if (stage.stageNumber === 1 || stage.stageNumber === 2) {
      return {
        stageNumber: stage.stageNumber,
        stageName: stage.stageName,
        contentJson,
        isCompleted: stage.isCompleted,
      };
    }

    if (stage.stageNumber === 3) {
      const summary = this.extractValidStage3Summary(contentJson);

      if (!summary) {
        return null;
      }

      return {
        stageNumber: stage.stageNumber,
        stageName: stage.stageName,
        contentJson: summary,
        isCompleted: stage.isCompleted,
      };
    }

    return null;
  }

  private extractValidStage3Summary(
    contentJson: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const summaryKeys = [
      'discussionSummary',
      'learningStrategy',
      'pedagogicalApproach',
      'facilityAndTechnologyUse',
      'digitalPlatform',
      'partnership',
      'finalStudentProduct',
      'activityFlowDecision',
      'differentiationPlan',
      'teacherNotes',
      'stage3CompletionStatus',
    ];
    const summary = Object.fromEntries(
      summaryKeys
        .filter((key) => contentJson[key] !== undefined)
        .map((key) => [key, contentJson[key]]),
    );
    const hasValidSummary = Object.values(summary).some((value) => {
      if (typeof value === 'string') {
        return value.trim().length > 0;
      }

      return (
        value !== null &&
        typeof value === 'object' &&
        Object.keys(value).length > 0
      );
    });

    return hasValidSummary ? summary : null;
  }

  private async buildKinaProfileContext(
    user: AuthUser,
    projectId?: string,
  ): Promise<string> {
    try {
      const profile = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
        include: { school: true },
      });
      const project = projectId
        ? await this.prisma.rppProject.findFirst({
            where: { id: projectId, userId: user.id },
            include: {
              school: true,
              teacherSubject: true,
              teacherClass: true,
              stages: { orderBy: { stageNumber: 'asc' } },
            },
          })
        : null;

      if (projectId && !project) {
        throw new NotFoundException('Project RPM tidak ditemukan.');
      }

      if (!profile && !project) {
        return user.name ? `Nama guru: ${user.name}.` : '';
      }

      const parts = [
        profile?.fullName ? `Nama guru: ${profile.fullName}` : null,
        profile?.school?.name ? `Sekolah: ${profile.school.name}` : null,
        profile?.school?.city ? `Kota: ${profile.school.city}` : null,
        project ? `Project RPM: ${project.title}` : null,
        project ? `Jenis RPM: ${project.rppType}` : null,
        project ? `Mapel: ${project.subject}` : null,
        project?.phase ? `Fase: ${project.phase}` : null,
        project?.gradeLevel ? `Kelas: ${project.gradeLevel}` : null,
        project?.topic ? `Topik: ${project.topic}` : null,
        project?.teacherClass?.className
          ? `Kelas ajar: ${project.teacherClass.className}`
          : null,
        project
          ? `Stage tersimpan: ${project.stages
              .map((stage) => `${stage.stageNumber}. ${stage.stageName}`)
              .join('; ')}`
          : null,
      ].filter(Boolean);
      return parts.join('\n');
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      return user.name ? `Nama guru: ${user.name}.` : '';
    }
  }

  private fallbackKinaReply(userText: string): string {
    const lower = userText.toLowerCase();
    if (lower.includes('rpp') || lower.includes('rencana')) {
      return 'Untuk menyusun RPM, pilih kartu Pembelajaran Intrakurikuler atau Kokurikuler di atas. KINA akan memandu langkah demi langkah di Studio Guru.';
    }
    if (lower.includes('halo') || lower.includes('hai')) {
      return 'Halo! Saya KINA, asisten Studio Guru PetunjukKU. Ada yang ingin Anda kerjakan hari ini?';
    }
    return 'Terima kasih atas pertanyaannya. Untuk menyusun RPM terstruktur, silakan buka Studio Guru lewat kartu Intrakurikuler atau Kokurikuler. Saya juga bisa menjawab pertanyaan singkat tentang perencanaan pembelajaran—coba tanyakan lagi setelah layanan AI aktif.';
  }

  async curateSchoolEnvironment(input: {
    schoolName?: string;
    schoolAddress?: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    rawPlaces: RawNearbyPlace[];
  }): Promise<{
    places: CuratedNearbyPlace[];
    summary: string;
    usedAi: boolean;
  }> {
    const ruleBased = curateNearbyPlaces(
      input.latitude,
      input.longitude,
      input.rawPlaces,
      18,
    );
    const candidates = buildNearbyPlaceCandidates(
      input.latitude,
      input.longitude,
      input.rawPlaces,
      ENVIRONMENT_CANDIDATE_LIMIT,
    );

    if (!this.isEnabled()) {
      return {
        places: this.limitPlacesPerCategory(ruleBased),
        summary: this.fallbackSummary(ruleBased, input.schoolName),
        usedAi: false,
      };
    }

    if (candidates.length === 0) {
      return {
        places: [],
        summary: this.fallbackSummary([], input.schoolName),
        usedAi: false,
      };
    }

    const candidatePayload = candidates.map((p) => ({
      id: p.id,
      name: p.name,
      primaryType: p.primaryType,
      types: p.types,
      latitude: p.latitude,
      longitude: p.longitude,
      distanceMeters: p.distanceMeters,
      distanceLabel: p.distanceLabel,
    }));

    try {
      const parsed =
        await this.aiGateway.postInternal<AiEnvironmentResponseJson>(
          'internal/ai/curate-school-environment',
          {
            schoolName: input.schoolName,
            schoolAddress: input.schoolAddress,
            latitude: input.latitude,
            longitude: input.longitude,
            radiusMeters: input.radiusMeters,
            candidates: candidatePayload,
            maxPlaces: 18,
            maxPlacesPerCategory: 3,
            minCategories: 4,
          },
        );

      const merged = this.mergeAiCuration(candidates, parsed);
      if (merged.places.length === 0) {
        throw new Error('AI tidak memilih lokasi valid');
      }

      return {
        places: merged.places,
        summary:
          merged.summary.trim() ||
          this.fallbackSummary(merged.places, input.schoolName),
        usedAi: true,
      };
    } catch (error) {
      this.logger.warn(
        `Kurasi AI gagal, pakai aturan: ${error instanceof Error ? error.message : error}`,
      );
      return {
        places: this.limitPlacesPerCategory(ruleBased),
        summary: this.fallbackSummary(ruleBased, input.schoolName),
        usedAi: false,
      };
    }
  }

  private mergeAiCuration(
    candidates: NearbyPlaceCandidate[],
    ai: AiEnvironmentResponseJson,
  ): { places: CuratedNearbyPlace[]; summary: string } {
    const byId = new Map(candidates.map((p) => [p.id, p]));
    const places: CuratedNearbyPlace[] = [];

    for (const row of ai.places ?? []) {
      const id = row.id?.trim();
      if (!id) {
        continue;
      }
      const base = byId.get(id);
      if (!base) {
        continue;
      }

      const colorKey = ALLOWED_COLOR_KEYS.has(row.colorKey ?? '')
        ? (row.colorKey as string)
        : 'gray';
      const category =
        row.category?.trim() ||
        this.categoryLabelFromId(row.categoryId) ||
        'Lingkungan sekitar';
      const categoryId =
        this.normalizeCategoryId(row.categoryId) ??
        this.normalizeCategoryId(category) ??
        'umum';

      places.push({
        id: base.id,
        name: base.name,
        distanceMeters: base.distanceMeters,
        distanceLabel: formatDistanceLabel(base.distanceMeters),
        categoryId,
        category,
        colorKey,
        relevanceNote:
          row.relevanceNote?.trim() ||
          'Dipilih AI sebagai konteks sekitar sekolah yang relevan untuk pembelajaran.',
        relevanceScore:
          typeof row.relevanceScore === 'number'
            ? Math.max(0, Math.min(100, row.relevanceScore))
            : 70,
      });
    }

    return {
      places: this.limitPlacesPerCategory(places),
      summary: ai.summary?.trim() ?? '',
    };
  }

  private limitPlacesPerCategory(
    places: CuratedNearbyPlace[],
    totalLimit = 18,
    perCategoryLimit = 3,
  ): CuratedNearbyPlace[] {
    const sorted = [...places].sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return a.distanceMeters - b.distanceMeters;
    });
    const counts = new Map<string, number>();
    const picked: CuratedNearbyPlace[] = [];

    for (const place of sorted) {
      if (picked.length >= totalLimit) {
        break;
      }
      const key = place.categoryId || place.category || 'umum';
      const count = counts.get(key) ?? 0;
      if (count >= perCategoryLimit) {
        continue;
      }
      counts.set(key, count + 1);
      picked.push(place);
    }

    return picked.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  private normalizeCategoryId(value?: string): string | null {
    const normalized = value
      ?.trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' dan ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalized || null;
  }

  private categoryLabelFromId(value?: string): string | null {
    const id = this.normalizeCategoryId(value);
    if (!id) {
      return null;
    }

    return id
      .split('-')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private fallbackSummary(
    places: CuratedNearbyPlace[],
    schoolName?: string,
  ): string {
    if (places.length === 0) {
      return schoolName
        ? `Belum ditemukan titik lingkungan signifikan dalam radius pencarian dari ${schoolName}.`
        : 'Belum ditemukan titik lingkungan signifikan dalam radius pencarian.';
    }
    const label = schoolName
      ? `sekitar ${schoolName}`
      : 'sekitar lokasi sekolah';
    return `Ditemukan ${places.length} titik ${label} yang dapat dipakai sebagai konteks pembelajaran.`;
  }

  async generateRpp(user: AuthUser, projectId: string) {
    const context = await this.buildRppGenerationContext(user, projectId);
    const aiCfg = this.configService.get('ai', { infer: true })!;

    if (context.project.rppType === 'pjbl_kokurikuler') {
      const rawChatHistory = context.kinaChatSummary['rawChatHistory'];
      const chatHistory = Array.isArray(rawChatHistory) ? rawChatHistory : [];

      if (chatHistory.length > 0 && this.isEnabled()) {
        try {
          const summaryResponse =
            await this.aiGateway.postInternal<KinaSummaryFastApiResponse>(
              'internal/ai/summarize-kina-chat',
              {
                project: context.project,
                chatHistory,
                summaryType: 'pjbl_kokurikuler_stage_3',
              },
            );

          if (summaryResponse.summary) {
            context.kinaChatSummary = {
              ...context.kinaChatSummary,
              ...summaryResponse.summary,
              source: 'summarize-kina-chat',
            };
          }
        } catch (error) {
          this.logger.warn(
            `Summary Kina PjBL gagal, pakai fallback lokal: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }
    }

    const response =
      await this.aiGateway.postInternal<GenerateRppFastApiResponse>(
        'internal/ai/generate-rpp',
        context as Record<string, unknown>,
        { timeoutMs: aiCfg.generateRequestTimeoutMs },
      );

    if (!response.contentJson || typeof response.contentJson !== 'object') {
      throw new BadRequestException(
        'AI service tidak mengembalikan contentJson yang valid.',
      );
    }

    const generated = await this.prisma.$transaction(async (tx) => {
      const created = await tx.generatedRpp.create({
        data: {
          userId: user.id,
          rppProjectId: projectId,
          contentJson: response.contentJson as Prisma.InputJsonValue,
          contentMarkdown: response.contentMarkdown,
          usedReferences:
            response.usedReferences === undefined
              ? undefined
              : (response.usedReferences as Prisma.InputJsonValue),
          model: response.model,
          status: 'success',
        },
        include: {
          rppProject: true,
          exportedDocuments: true,
        },
      });

      if (response.usedReferences !== undefined) {
        await tx.ragRetrievalLog.create({
          data: {
            userId: user.id,
            rppProjectId: projectId,
            generatedRppId: created.id,
            query: {
              subject: context.project.subject,
              phase: context.project.phase,
              topic: context.project.topic,
            },
            references: response.usedReferences as Prisma.InputJsonValue,
            source: 'generate-rpp',
          },
        });
      }

      await tx.rppProject.update({
        where: { id: projectId },
        data: { status: RppStatus.generated },
      });

      return created;
    });

    return generated;
  }

  async getGeneratedRpp(user: AuthUser, projectId: string) {
    await this.assertProjectOwner(user, projectId);

    return this.prisma.generatedRpp.findMany({
      where: {
        userId: user.id,
        rppProjectId: projectId,
      },
      include: {
        exportedDocuments: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async updateGeneratedRpp(
    user: AuthUser,
    generatedRppId: string,
    body: {
      contentJson?: Record<string, unknown>;
      contentMarkdown?: string;
      usedReferences?: unknown[];
      model?: string;
    },
  ) {
    const existing = await this.prisma.generatedRpp.findFirst({
      where: {
        id: generatedRppId,
        userId: user.id,
      },
    });

    if (!existing) {
      throw new NotFoundException('RPM yang dihasilkan tidak ditemukan.');
    }

    return this.prisma.generatedRpp.update({
      where: { id: existing.id },
      data: {
        contentJson:
          body.contentJson === undefined
            ? undefined
            : (body.contentJson as Prisma.InputJsonValue),
        contentMarkdown: body.contentMarkdown,
        usedReferences:
          body.usedReferences === undefined
            ? undefined
            : (body.usedReferences as Prisma.InputJsonValue),
        model: body.model,
        status: 'regenerated',
      },
      include: {
        exportedDocuments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  private async assertProjectOwner(user: AuthUser, projectId: string) {
    const project = await this.prisma.rppProject.findFirst({
      where: { id: projectId, userId: user.id },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException('Project RPM tidak ditemukan.');
    }

    return project;
  }

  private async buildRppGenerationContext(user: AuthUser, projectId: string) {
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

    const chatSummary = await this.prisma.kinaChat.findMany({
      where: {
        userId: user.id,
        rppProjectId: projectId,
      },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });
    const kinaChatHistory = chatSummary.map((chat) => ({
      role: chat.role,
      message: chat.content,
      createdAt: chat.createdAt,
    }));

    const environmentScan =
      project.school?.environmentScans?.[0] ??
      project.teacherProfile.school?.environmentScans?.[0] ??
      null;
    const school = project.school ?? project.teacherProfile.school;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
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
      },
      teacherProfile: {
        id: project.teacherProfile.id,
        fullName: project.teacherProfile.fullName,
        position: project.teacherProfile.position,
        educationLevel: project.teacherProfile.educationLevel,
        teachingExperienceYears: project.teacherProfile.teachingExperienceYears,
        teachingContext: project.teacherProfile.teachingContext,
      },
      school: school
        ? {
            id: school.id,
            name: school.name,
            province: school.province,
            city: school.city,
            district: school.district,
            address: school.address,
            schoolEnvironment: school.schoolEnvironment,
            availableFacilities: this.toStringList(school.availableFacilities),
            localContext: school.localContext,
          }
        : {},
      teacherSubject: project.teacherSubject
        ? {
            id: project.teacherSubject.id,
            subjectName: project.teacherSubject.subjectName,
            phase: project.teacherSubject.phase ?? project.phase,
            gradeLevel: project.teacherSubject.gradeLevel ?? project.gradeLevel,
          }
        : {
            subjectName: project.subject,
            phase: project.phase,
            gradeLevel: project.gradeLevel,
          },
      teacherClass: project.teacherClass
        ? {
            id: project.teacherClass.id,
            className: project.teacherClass.className,
            gradeLevel: project.teacherClass.gradeLevel ?? project.gradeLevel,
            academicYear: project.teacherClass.academicYear,
            studentCount: project.teacherClass.studentCount,
            studentCharacteristics: project.teacherClass.studentCharacteristics,
            learningChallenges: this.toStringList(
              project.teacherClass.learningChallenges,
            ),
            dominantLearningStyle: project.teacherClass.dominantLearningStyle,
          }
        : {
            gradeLevel: project.gradeLevel,
          },
      stages: project.stages.map((stage) => ({
        stageNumber: stage.stageNumber,
        stageName: stage.stageName,
        contentJson: stage.contentJson,
        isCompleted: stage.isCompleted,
      })),
      kinaChatSummary: this.buildPjblKinaFallbackSummary(
        project.rppType,
        kinaChatHistory,
      ),
      chatSummary: kinaChatHistory.map((chat) => ({
        role: chat.role,
        content: chat.message,
        createdAt: chat.createdAt,
      })),
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
  }

  private buildPjblKinaFallbackSummary(
    rppType: string,
    history: Array<{ role: string; message: string; createdAt: Date }>,
  ): Record<string, unknown> {
    if (rppType !== 'pjbl_kokurikuler') {
      return {};
    }

    const rawText = history
      .map((chat) => `${chat.role}: ${chat.message}`)
      .join('\n')
      .trim();
    const userMessages = history
      .filter((chat) => chat.role === 'user')
      .map((chat) => chat.message.trim())
      .filter(Boolean);
    const latestTeacherNotes = userMessages.slice(-5).join(' ');
    const completePattern =
      /rancangan proyek .*sudah selesai|siap digunakan|cukup semua|sudah lengkap/i;

    return {
      rawChatHistory: history.map((chat) => ({
        role: chat.role,
        message: chat.message,
        createdAt: chat.createdAt,
      })),
      discussionSummary:
        rawText.slice(0, 1200) ||
        'Belum ada percakapan Kina yang cukup untuk diringkas.',
      teacherNotes:
        latestTeacherNotes.slice(0, 800) ||
        'Belum ada catatan tambahan dari percakapan Kina.',
      projectCompletionStatus: completePattern.test(rawText)
        ? 'complete'
        : 'draft',
    };
  }
}
