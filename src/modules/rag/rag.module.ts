import { Module } from '@nestjs/common';

import { AiGatewayService } from './ai-gateway.service';
import { RagController } from './rag.controller';

@Module({
  controllers: [RagController],
  providers: [AiGatewayService],
  exports: [AiGatewayService],
})
export class RagModule {}
