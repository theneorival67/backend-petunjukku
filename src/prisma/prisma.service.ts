import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Database connection failed during startup. API tetap berjalan, tetapi endpoint yang memakai database akan gagal sampai DATABASE_URL/DIRECT_URL diperbaiki. ${message}`,
      );
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Database disconnect failed: ${message}`);
    }
  }
}
