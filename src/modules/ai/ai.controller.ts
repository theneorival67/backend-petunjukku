import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AiService } from './ai.service';
import { KinaChatDto, KinaChatResponseDto } from './dto/kina-chat.dto';
import {
  KinaSessionTitleDto,
  KinaSessionTitleResponseDto,
} from './dto/kina-session-title.dto';
import { OpencodeGoClient } from './opencode-go.client';

@ApiTags('ai')
@ApiBearerAuth('supabase')
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly opencodeGo: OpencodeGoClient,
    private readonly configService: ConfigService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Status konfigurasi OpenCode Go' })
  status() {
    const cfg = this.configService.get('ai', { infer: true });
    return {
      enabled: this.aiService.isEnabled(),
      configured: this.opencodeGo.isConfigured(),
      baseUrl: cfg?.goBaseUrl ?? null,
      envModel: cfg?.envModel ?? null,
      chatModel: cfg?.chatModel ?? null,
    };
  }

  @Post('kina/chat')
  @ApiOperation({ summary: 'Obrolan dengan KINA (OpenCode Go)' })
  @ApiOkResponse({ type: KinaChatResponseDto })
  async kinaChat(
    @CurrentUser() user: AuthUser,
    @Body() dto: KinaChatDto,
  ): Promise<KinaChatResponseDto> {
    return this.aiService.kinaChat(user, dto.messages);
  }

  @Post('kina/session-title')
  @ApiOperation({ summary: 'Saran judul sesi dari pesan chat pertama' })
  @ApiOkResponse({ type: KinaSessionTitleResponseDto })
  suggestSessionTitle(
    @Body() dto: KinaSessionTitleDto,
  ): Promise<KinaSessionTitleResponseDto> {
    return this.aiService.suggestSessionTitle(dto.message);
  }
}
