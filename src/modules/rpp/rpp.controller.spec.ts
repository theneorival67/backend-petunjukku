import { Test, TestingModule } from '@nestjs/testing';
import { RppController } from './rpp.controller';

describe('RppController', () => {
  let controller: RppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RppController],
    }).compile();

    controller = module.get<RppController>(RppController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
