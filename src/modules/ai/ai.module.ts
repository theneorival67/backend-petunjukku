import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { OpencodeGoClient } from './opencode-go.client';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [OpencodeGoClient, AiService],
  exports: [AiService, OpencodeGoClient],
})
export class AiModule {}
