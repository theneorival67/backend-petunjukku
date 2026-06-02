import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async findProjects(user: AuthUser) {
    await this.usersService.syncSupabaseUser(user);

    return this.prisma.rppProject.findMany({
      where: {
        userId: user.id,
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

  async findDocuments(user: AuthUser) {
    await this.usersService.syncSupabaseUser(user);

    const [generatedRpps, exportedDocuments] = await Promise.all([
      this.prisma.generatedRpp.findMany({
        where: {
          userId: user.id,
        },
        include: {
          rppProject: true,
          exportedDocuments: {
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      }),
      this.prisma.exportedDocument.findMany({
        where: {
          userId: user.id,
        },
        include: {
          rppProject: true,
          generatedRpp: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    return { generatedRpps, exportedDocuments };
  }
}
