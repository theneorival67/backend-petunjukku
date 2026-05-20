import { Test, TestingModule } from '@nestjs/testing';
import { TeacherProfileController } from './teacher-profile.controller';

describe('TeacherProfileController', () => {
  let controller: TeacherProfileController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeacherProfileController],
    }).compile();

    controller = module.get<TeacherProfileController>(TeacherProfileController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
