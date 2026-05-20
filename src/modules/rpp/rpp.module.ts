import { Module } from '@nestjs/common';
import { RppController } from './rpp.controller';
import { RppService } from './rpp.service';

@Module({
  controllers: [RppController],
  providers: [RppService]
})
export class RppModule {}
