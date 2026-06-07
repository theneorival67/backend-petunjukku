import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AiService } from './ai.service';
import { KinaChatDto, KinaChatResponseDto } from './dto/kina-chat.dto';
import {
  KinaSessionTitleDto,
  KinaSessionTitleResponseDto,
} from './dto/kina-session-title.dto';
import { Stage3DiagramDto } from './dto/stage3-diagram.dto';

@ApiTags('ai')
@ApiBearerAuth('supabase')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status konfigurasi FastAPI AI internal' })
  status() {
    return this.aiService.status();
  }

  @Post('kina/chat')
  @ApiOperation({ summary: 'Obrolan dengan KINA melalui FastAPI internal' })
  @ApiOkResponse({ type: KinaChatResponseDto })
  async kinaChat(
    @CurrentUser() user: AuthUser,
    @Body() dto: KinaChatDto,
  ): Promise<KinaChatResponseDto> {
    return this.aiService.kinaChat(user, dto);
  }

  @Post('kina/session-title')
  @ApiOperation({ summary: 'Saran judul sesi dari pesan chat pertama' })
  @ApiOkResponse({ type: KinaSessionTitleResponseDto })
  suggestSessionTitle(
    @Body() dto: KinaSessionTitleDto,
  ): Promise<KinaSessionTitleResponseDto> {
    return this.aiService.suggestSessionTitle(dto.message);
  }

  @Get('kina/chats/:projectId')
  @ApiOperation({ summary: 'Ambil riwayat chat KINA untuk project RPP' })
  kinaHistory(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.aiService.kinaHistory(user, projectId);
  }

  @Delete('kina/chats/:projectId')
  @ApiOperation({ summary: 'Hapus riwayat chat KINA untuk project RPP' })
  clearKinaHistory(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.aiService.clearKinaHistory(user, projectId);
  }

  @Post('stage3/diagrams/:projectId')
  @ApiOperation({ summary: 'Generate diagram alur pembelajaran Stage 3' })
  generateStage3Diagrams(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: Stage3DiagramDto,
  ) {
    return this.aiService.generateStage3Diagrams(user, projectId, dto);
  }

  @Post('generate-rpp/:projectId')
  @ApiOperation({
    summary: 'Generate dokumen RPP final',
    description:
      'Mengambil konteks project, stages, chat, referensi, dan konteks sekolah lalu meneruskan payload ke FastAPI internal.',
  })
  generateRpp(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.aiService.generateRpp(user, projectId);
  }

  @Get('generated-rpp/:projectId')
  @ApiOperation({
    summary: 'Ambil hasil generated RPP milik project',
  })
  getGeneratedRpp(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.aiService.getGeneratedRpp(user, projectId);
  }

  @Put('generated-rpp/:generatedRppId')
  @ApiOperation({
    summary: 'Update hasil generated RPP',
  })
  updateGeneratedRpp(
    @CurrentUser() user: AuthUser,
    @Param('generatedRppId') generatedRppId: string,
    @Body()
    body: {
      contentJson?: Record<string, unknown>;
      contentMarkdown?: string;
      usedReferences?: unknown[];
      model?: string;
    },
  ) {
    return this.aiService.updateGeneratedRpp(user, generatedRppId, body);
  }
}
