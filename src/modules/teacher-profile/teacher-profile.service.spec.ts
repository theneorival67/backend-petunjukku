import { Test, TestingModule } from '@nestjs/testing';
import { TeacherProfileService } from './teacher-profile.service';

describe('TeacherProfileService', () => {
  let service: TeacherProfileService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TeacherProfileService],
    }).compile();

    service = module.get<TeacherProfileService>(TeacherProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
