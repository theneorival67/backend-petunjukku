import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';
import { SupabaseService } from './supabase/supabase.service';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    let prismaStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      prismaStatus = e instanceof Error ? e.message : 'error';
    }

    const { error } = await this.supabaseService
      .getClient()
      .from('teacher_profiles')
      .select('id')
      .limit(1);

    const supabaseStatus =
      error && error.code !== 'PGRST116' && error.code !== '42P01'
        ? error.message
        : 'connected';

    return {
      status: prismaStatus === 'ok' ? 'ok' : 'degraded',
      prisma: prismaStatus,
      supabase: supabaseStatus,
      env: this.configService.get<string>('app.nodeEnv'),
      timestamp: new Date().toISOString(),
    };
  }
}
