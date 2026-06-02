import { Test, TestingModule } from '@nestjs/testing';
import { StageController } from './stage.controller';
import { StageService } from './stage.service';

describe('StageController', () => {
  let controller: StageController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StageController],
      providers: [{ provide: StageService, useValue: {} }],
    }).compile();

    controller = module.get<StageController>(StageController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
