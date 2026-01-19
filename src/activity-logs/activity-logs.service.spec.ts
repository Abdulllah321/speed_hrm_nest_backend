import { Test, TestingModule } from '@nestjs/testing';
import { ActivityLogsService } from './activity-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsGateway } from './activity-logs.gateway';

describe('ActivityLogsService', () => {
  let service: ActivityLogsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityLogsService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn() },
            activityLog: { create: jest.fn() },
          },
        },
        {
          provide: ActivityLogsGateway,
          useValue: { emitActivityLog: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ActivityLogsService>(ActivityLogsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
