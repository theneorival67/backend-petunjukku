import { Test, TestingModule } from '@nestjs/testing';
import { StageService } from './stage.service';

describe('StageService', () => {
  let service: StageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StageService],
    }).compile();

    service = module.get<StageService>(StageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
