import { Test, TestingModule } from '@nestjs/testing';
import { RppService } from './rpp.service';

describe('RppService', () => {
  let service: RppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RppService],
    }).compile();

    service = module.get<RppService>(RppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
