import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SaveRppStageDto } from './dto/save-rpp-stage.dto';
import { UpdateRppStageDto } from './dto/update-rpp-stage.dto';
import { StageService } from './stage.service';

@ApiTags('rpp-stages')
@ApiBearerAuth('supabase')
@Controller('rpp/projects/:projectId/stages')
export class StageController {
  constructor(private readonly stageService: StageService) {}

  @ApiOperation({ summary: 'Ambil semua stage dari project RPP' })
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.stageService.findAll(user, projectId);
  }

  @ApiOperation({ summary: 'Ambil detail stage berdasarkan nomor stage' })
  @Get(':stageNumber')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('stageNumber', ParseIntPipe) stageNumber: number,
  ) {
    return this.stageService.findOne(user, projectId, stageNumber);
  }

  @ApiOperation({ summary: 'Simpan atau upsert stage RPP' })
  @Post()
  save(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: SaveRppStageDto,
  ) {
    return this.stageService.save(user, projectId, dto);
  }

  @ApiOperation({ summary: 'Update sebagian data stage RPP' })
  @Patch(':stageNumber')
  update(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('stageNumber', ParseIntPipe) stageNumber: number,
    @Body() dto: UpdateRppStageDto,
  ) {
    return this.stageService.update(user, projectId, stageNumber, dto);
  }
}
