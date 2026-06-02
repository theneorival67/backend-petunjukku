import { Test, TestingModule } from '@nestjs/testing';
import { TeacherClassService } from './teacher-class.service';
import { TeacherProfileController } from './teacher-profile.controller';
import { TeacherProfileService } from './teacher-profile.service';
import { TeacherSubjectService } from './teacher-subject.service';

describe('TeacherProfileController', () => {
  let controller: TeacherProfileController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeacherProfileController],
      providers: [
        {
          provide: TeacherProfileService,
          useValue: {
            findMine: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
          },
        },
        { provide: TeacherSubjectService, useValue: {} },
        { provide: TeacherClassService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TeacherProfileController>(TeacherProfileController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
