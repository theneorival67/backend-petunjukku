import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/interfaces/auth-user.interface';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async syncSupabaseUser(authUser: AuthUser) {
    return this.prisma.user.upsert({
      where: {
        id: authUser.id,
      },
      update: {
        email: authUser.email ?? '',
        name: authUser.name ?? authUser.email?.split('@')[0] ?? null,
      },
      create: {
        id: authUser.id,
        email: authUser.email ?? '',
        name: authUser.name ?? authUser.email?.split('@')[0] ?? null,
        role: 'teacher',
        isActive: true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }
}
