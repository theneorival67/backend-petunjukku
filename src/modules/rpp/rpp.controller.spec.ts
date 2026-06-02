import { Test, TestingModule } from '@nestjs/testing';
import { RppController } from './rpp.controller';
import { RppService } from './rpp.service';

describe('RppController', () => {
  let controller: RppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RppController],
      providers: [{ provide: RppService, useValue: {} }],
    }).compile();

    controller = module.get<RppController>(RppController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
