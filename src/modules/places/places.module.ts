import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

@Module({
  imports: [AiModule],
  controllers: [PlacesController],
  providers: [PlacesService],
  exports: [PlacesService],
})
export class PlacesModule {}
