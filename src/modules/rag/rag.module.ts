import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AiGatewayService } from './ai-gateway.service';
import { RagController } from './rag.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RagController],
  providers: [AiGatewayService],
  exports: [AiGatewayService],
})
export class RagModule {}
