import { Test, TestingModule } from '@nestjs/testing';
import { PosSessionService } from './pos-session.service';

describe('PosSessionService', () => {
  let service: PosSessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PosSessionService],
    }).compile();

    service = module.get<PosSessionService>(PosSessionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
