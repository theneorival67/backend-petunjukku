import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SchoolModule } from './modules/school/school.module';
import { TeacherProfileModule } from './modules/teacher-profile/teacher-profile.module';
import { RppModule } from './modules/rpp/rpp.module';
import { StageModule } from './modules/stage/stage.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';

@Module({
  imports: [SchoolModule, TeacherProfileModule, RppModule, StageModule, WorkspaceModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
