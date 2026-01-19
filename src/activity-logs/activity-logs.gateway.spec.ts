import { Test, TestingModule } from '@nestjs/testing';
import { ActivityLogsGateway } from './activity-logs.gateway';

describe('ActivityLogsGateway', () => {
  let gateway: ActivityLogsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ActivityLogsGateway],
    }).compile();

    gateway = module.get<ActivityLogsGateway>(ActivityLogsGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
