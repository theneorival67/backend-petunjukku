import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RppStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { UsersService } from '../users/users.service';
import { SaveRppStageDto } from './dto/save-rpp-stage.dto';
import { UpdateRppStageDto } from './dto/update-rpp-stage.dto';

@Injectable()
export class StageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private async getRppProjectOrThrow(user: AuthUser, projectId: string) {
    await this.usersService.syncSupabaseUser(user);

    const project = await this.prisma.rppProject.findFirst({
      where: {
        id: projectId,
        userId: user.id,
      },
    });

    if (!project) {
      throw new NotFoundException('Project RPP tidak ditemukan.');
    }

    return project;
  }

  private toJsonInput(contentJson: Record<string, unknown>) {
    return contentJson as Prisma.InputJsonObject;
  }

  async findAll(user: AuthUser, projectId: string) {
    await this.getRppProjectOrThrow(user, projectId);

    return this.prisma.rppStage.findMany({
      where: {
        rppProjectId: projectId,
      },
      orderBy: {
        stageNumber: 'asc',
      },
    });
  }

  async findOne(user: AuthUser, projectId: string, stageNumber: number) {
    await this.getRppProjectOrThrow(user, projectId);

    const stage = await this.prisma.rppStage.findUnique({
      where: {
        rppProjectId_stageNumber: {
          rppProjectId: projectId,
          stageNumber,
        },
      },
    });

    if (!stage) {
      throw new NotFoundException('Stage RPP tidak ditemukan.');
    }

    return stage;
  }

  async save(user: AuthUser, projectId: string, dto: SaveRppStageDto) {
    await this.getRppProjectOrThrow(user, projectId);

    const stage = await this.prisma.rppStage.upsert({
      where: {
        rppProjectId_stageNumber: {
          rppProjectId: projectId,
          stageNumber: dto.stageNumber,
        },
      },
      create: {
        rppProjectId: projectId,
        stageNumber: dto.stageNumber,
        stageName: dto.stageName.trim(),
        contentJson: this.toJsonInput(dto.contentJson),
        isCompleted: dto.isCompleted ?? false,
      },
      update: {
        stageName: dto.stageName.trim(),
        contentJson: this.toJsonInput(dto.contentJson),
        isCompleted: dto.isCompleted ?? false,
      },
    });

    await this.prisma.rppProject.update({
      where: {
        id: projectId,
      },
      data: {
        status: RppStatus.in_progress,
      },
    });

    return {
      message: 'Stage RPP berhasil disimpan.',
      stage,
    };
  }

  async update(
    user: AuthUser,
    projectId: string,
    stageNumber: number,
    dto: UpdateRppStageDto,
  ) {
    await this.getRppProjectOrThrow(user, projectId);

    const existingStage = await this.prisma.rppStage.findUnique({
      where: {
        rppProjectId_stageNumber: {
          rppProjectId: projectId,
          stageNumber,
        },
      },
    });

    if (!existingStage) {
      throw new NotFoundException('Stage RPP tidak ditemukan.');
    }

    const stage = await this.prisma.rppStage.update({
      where: {
        rppProjectId_stageNumber: {
          rppProjectId: projectId,
          stageNumber,
        },
      },
      data: {
        ...(dto.stageName !== undefined
          ? { stageName: dto.stageName.trim() }
          : {}),
        ...(dto.contentJson !== undefined
          ? { contentJson: this.toJsonInput(dto.contentJson) }
          : {}),
        ...(dto.isCompleted !== undefined
          ? { isCompleted: dto.isCompleted }
          : {}),
      },
    });

    await this.prisma.rppProject.update({
      where: {
        id: projectId,
      },
      data: {
        status: RppStatus.in_progress,
      },
    });

    return {
      message: 'Stage RPP berhasil diperbarui.',
      stage,
    };
  }
}
