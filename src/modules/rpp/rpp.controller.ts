import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateRppProjectDto } from './dto/create-rpp-project.dto';
import { UpdateRppProjectDto } from './dto/update-rpp-project.dto';
import { LintasDisiplinRecommendationResponseDto } from './dto/lintas-disiplin-recommendation.dto';
import { RecommendStageOverrideDto } from './dto/recommend-stage.dto';
import { StageRecommendationResponseDto } from './dto/stage-recommendation.dto';
import { RppService } from './rpp.service';

@ApiTags('rpp-projects')
@ApiBearerAuth('supabase')
@Controller('rpp/projects')
export class RppController {
  constructor(private readonly rppService: RppService) {}

  @ApiOperation({ summary: 'Buat project RPP baru' })
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRppProjectDto) {
    return this.rppService.create(user, dto);
  }

  @ApiOperation({ summary: 'Ambil semua project RPP milik user login' })
  @Get()
  findMine(
    @CurrentUser() user: AuthUser,
    @Query('archived') archived?: string,
  ) {
    return this.rppService.findMine(user, archived === 'true');
  }

  @ApiOperation({ summary: 'Ambil detail project RPP' })
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rppService.findOne(user, id);
  }

  @ApiOperation({
    summary: 'Minta rekomendasi AI untuk Stage 2 tanpa menyimpan ke stage',
    description:
      'Hanya berlaku untuk stageNumber=2. NestJS mengambil konteks project dari database, meneruskan payload ke FastAPI internal, lalu mengembalikan rekomendasi agar guru bisa review/edit.',
  })
  @Post(':projectId/ai/stages/:stageNumber/recommend')
  recommendStage(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('stageNumber') stageNumber: string,
    @Body() body: RecommendStageOverrideDto,
  ): Promise<StageRecommendationResponseDto> {
    return this.rppService.recommendStage(
      user,
      projectId,
      Number(stageNumber),
      body,
    );
  }

  @ApiOperation({
    summary: 'Rekomendasi 5 mata pelajaran lintas disiplin dari AI',
    description:
      'Mengambil konteks Stage 1 dari database lalu meminta FastAPI merekomendasikan 5 mapel lintas disiplin yang relevan.',
  })
  @Post(':projectId/ai/lintas-disiplin/recommend')
  recommendLintasDisiplin(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() body: { profilLulusan?: string[] },
  ): Promise<LintasDisiplinRecommendationResponseDto> {
    return this.rppService.recommendLintasDisiplin(
      user,
      projectId,
      body?.profilLulusan ?? [],
    );
  }

  @ApiOperation({ summary: 'Update project RPP' })
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRppProjectDto,
  ) {
    return this.rppService.update(user, id, dto);
  }

  @ApiOperation({ summary: 'Arsipkan project RPP' })
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rppService.archive(user, id);
  }

  @ApiOperation({ summary: 'Hapus permanen project RPP' })
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rppService.remove(user, id);
  }
}
