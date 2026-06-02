import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';
import { UsersModule } from '../users/users.module';
import { RppController } from './rpp.controller';
import { RppService } from './rpp.service';

@Module({
  imports: [PrismaModule, UsersModule, RagModule],
  controllers: [RppController],
  providers: [RppService],
  exports: [RppService],
})
export class RppModule {}
