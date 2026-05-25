import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TeacherProfileService } from './teacher-profile.service';

describe('TeacherProfileService', () => {
  let service: TeacherProfileService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeacherProfileService,
        {
          provide: PrismaService,
          useValue: {
            teacherProfile: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              upsert: jest.fn(),
            },
            school: {
              findFirst: jest.fn(),
              create: jest.fn(),
            },
          },
        },
        {
          provide: UsersService,
          useValue: {
            syncSupabaseUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TeacherProfileService>(TeacherProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
