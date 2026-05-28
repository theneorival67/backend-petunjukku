import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateKinaThreadMessageDto } from './dto/create-kina-thread-message.dto';
import { UpdateKinaThreadMessageDto } from './dto/update-kina-thread-message.dto';
import { KinaThreadService } from './kina-thread.service';

@ApiTags('kina-thread')
@ApiBearerAuth('supabase')
@Controller('rpp/projects/:projectId/thread/messages')
export class KinaThreadController {
  constructor(private readonly kinaThreadService: KinaThreadService) {}

  @ApiOperation({ summary: 'Ambil semua pesan thread KINA pada project RPP' })
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.kinaThreadService.findAll(user, projectId);
  }

  @ApiOperation({ summary: 'Simpan pesan baru pada thread KINA' })
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateKinaThreadMessageDto,
  ) {
    return this.kinaThreadService.create(user, projectId, dto);
  }

  @ApiOperation({ summary: 'Update pesan/tool result pada thread KINA' })
  @Patch(':messageId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateKinaThreadMessageDto,
  ) {
    return this.kinaThreadService.update(user, projectId, messageId, dto);
  }
}
