import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { SupabaseService } from './supabase/supabase.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  @Get('health')
  async health() {
    // Cek koneksi Prisma
    let prismaStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      prismaStatus = e.message;
    }

    // Cek koneksi Supabase
    const { error } = await this.supabaseService
      .getClient()
      .from('_supabase_migrations')
      .select('count')
      .limit(1);

    return {
      status: prismaStatus === 'ok' && !error ? 'ok' : 'degraded',
      prisma: prismaStatus,
      supabase: error ? error.message : 'connected',
      env: this.configService.get<string>('app.nodeEnv'),
      timestamp: new Date().toISOString(),
    };
  }
}