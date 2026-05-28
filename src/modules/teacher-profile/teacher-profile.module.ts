import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlacesModule } from '../places/places.module';
import { UsersModule } from '../users/users.module';
import { TeacherProfileController } from './teacher-profile.controller';
import { TeacherClassService } from './teacher-class.service';
import { TeacherProfileService } from './teacher-profile.service';
import { TeacherSubjectService } from './teacher-subject.service';

@Module({
  imports: [PrismaModule, UsersModule, forwardRef(() => PlacesModule)],
  controllers: [TeacherProfileController],
  providers: [
    TeacherProfileService,
    TeacherSubjectService,
    TeacherClassService,
  ],
  exports: [
    TeacherProfileService,
    TeacherSubjectService,
    TeacherClassService,
  ],
})
export class TeacherProfileModule {}
