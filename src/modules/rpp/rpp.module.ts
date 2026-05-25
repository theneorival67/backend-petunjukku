import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { RppController } from './rpp.controller';
import { RppService } from './rpp.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [RppController],
  providers: [RppService],
  exports: [RppService],
})
export class RppModule {}
