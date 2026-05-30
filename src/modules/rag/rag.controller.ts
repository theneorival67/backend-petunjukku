import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AiGatewayService } from './ai-gateway.service';
import { RagSearchDto, RagSearchResponseDto } from './dto/rag-search.dto';

@ApiTags('rag')
@ApiBearerAuth('supabase')
@Controller('rag')
export class RagController {
  constructor(private readonly aiGatewayService: AiGatewayService) {}

  @Post('search')
  @ApiOperation({
    summary: 'Mencari referensi Capaian Pembelajaran yang relevan',
  })
  @ApiOkResponse({ type: RagSearchResponseDto })
  search(@Body() dto: RagSearchDto): Promise<RagSearchResponseDto> {
    return this.aiGatewayService.search(dto);
  }
}
