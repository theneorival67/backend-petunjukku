import { Module } from '@nestjs/common';
import { TeacherProfileController } from './teacher-profile.controller';
import { TeacherProfileService } from './teacher-profile.service';

@Module({
  controllers: [TeacherProfileController],
  providers: [TeacherProfileService]
})
export class TeacherProfileModule {}
