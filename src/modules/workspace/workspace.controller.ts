import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { WorkspaceService } from './workspace.service';

@ApiTags('workspace')
@ApiBearerAuth('supabase')
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('projects')
  @ApiOperation({
    summary: 'Ambil project RPM untuk workspace user login',
    description:
      'Workspace tidak memakai tabel khusus; data diambil dari rpp_projects milik user login.',
  })
  projects(@CurrentUser() user: AuthUser) {
    return this.workspaceService.findProjects(user);
  }

  @Get('documents')
  @ApiOperation({
    summary: 'Ambil dokumen workspace user login',
    description:
      'Akan membaca generated_rpps dan exported_documents setelah model Prisma tersedia.',
  })
  documents(@CurrentUser() user: AuthUser) {
    return this.workspaceService.findDocuments(user);
  }
}
