import { Test, TestingModule } from '@nestjs/testing';
import { TeacherProfileController } from './teacher-profile.controller';
import { TeacherProfileService } from './teacher-profile.service';

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
      ],
    }).compile();

    controller = module.get<TeacherProfileController>(TeacherProfileController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
