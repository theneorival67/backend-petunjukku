import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../rag/ai-gateway.service';
import { UsersService } from '../users/users.service';
import { RppService } from './rpp.service';

describe('RppService', () => {
  let service: RppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RppService,
        { provide: PrismaService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: AiGatewayService, useValue: {} },
      ],
    }).compile();

    service = module.get<RppService>(RppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
