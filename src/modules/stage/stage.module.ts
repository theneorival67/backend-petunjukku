import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { StageController } from './stage.controller';
import { StageService } from './stage.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [StageController],
  providers: [StageService],
  exports: [StageService],
})
export class StageModule {}
