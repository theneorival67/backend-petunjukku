import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@ApiBearerAuth('supabase')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('export/pdf/:generatedRppId')
  @ApiOperation({
    summary: 'Export generated RPP ke PDF',
    description:
      'Mengambil generated RPP, render ke PDF, upload ke Supabase Storage, lalu simpan metadata exported_documents.',
  })
  exportPdf(
    @CurrentUser() user: AuthUser,
    @Param('generatedRppId') generatedRppId: string,
  ) {
    return this.documentsService.export(user, generatedRppId, 'pdf');
  }

  @Post('export/docx/:generatedRppId')
  @ApiOperation({
    summary: 'Export generated RPP ke DOCX',
    description:
      'Mengambil generated RPP, render ke DOCX, upload ke Supabase Storage, lalu simpan metadata exported_documents.',
  })
  exportDocx(
    @CurrentUser() user: AuthUser,
    @Param('generatedRppId') generatedRppId: string,
  ) {
    return this.documentsService.export(user, generatedRppId, 'docx');
  }

  @Get('download/:documentId')
  @ApiOperation({
    summary: 'Ambil URL download dokumen',
  })
  download(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
  ) {
    return this.documentsService.download(user, documentId);
  }
}
