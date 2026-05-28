import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { KinaThreadController } from './kina-thread.controller';
import { KinaThreadService } from './kina-thread.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [KinaThreadController],
  providers: [KinaThreadService],
  exports: [KinaThreadService],
})
export class KinaThreadModule {}
