import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateKinaThreadMessageDto } from './dto/create-kina-thread-message.dto';
import { UpdateKinaThreadMessageDto } from './dto/update-kina-thread-message.dto';

@Injectable()
export class KinaThreadService {
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

  private toJsonInput(value?: Record<string, unknown>) {
    return value === undefined
      ? undefined
      : (value as Prisma.InputJsonObject);
  }

  async findAll(user: AuthUser, projectId: string) {
    await this.getRppProjectOrThrow(user, projectId);

    return this.prisma.kinaThreadMessage.findMany({
      where: {
        rppProjectId: projectId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async create(
    user: AuthUser,
    projectId: string,
    dto: CreateKinaThreadMessageDto,
  ) {
    await this.getRppProjectOrThrow(user, projectId);

    return this.prisma.kinaThreadMessage.create({
      data: {
        rppProjectId: projectId,
        role: dto.role,
        content: dto.content,
        messageType: dto.messageType?.trim() || 'text',
        metadata: this.toJsonInput(dto.metadata),
        toolName: dto.toolName?.trim() || undefined,
        toolState: this.toJsonInput(dto.toolState),
      },
    });
  }

  async update(
    user: AuthUser,
    projectId: string,
    messageId: string,
    dto: UpdateKinaThreadMessageDto,
  ) {
    await this.getRppProjectOrThrow(user, projectId);

    const existing = await this.prisma.kinaThreadMessage.findFirst({
      where: {
        id: messageId,
        rppProjectId: projectId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Pesan thread KINA tidak ditemukan.');
    }

    return this.prisma.kinaThreadMessage.update({
      where: {
        id: messageId,
      },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.messageType !== undefined
          ? { messageType: dto.messageType.trim() || 'text' }
          : {}),
        ...(dto.metadata !== undefined
          ? { metadata: this.toJsonInput(dto.metadata) }
          : {}),
        ...(dto.toolName !== undefined
          ? { toolName: dto.toolName.trim() || null }
          : {}),
        ...(dto.toolState !== undefined
          ? { toolState: this.toJsonInput(dto.toolState) }
          : {}),
      },
    });
  }
}
