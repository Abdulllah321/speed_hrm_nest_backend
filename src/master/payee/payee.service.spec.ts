import { Test, TestingModule } from '@nestjs/testing';
import { PayeeService } from './payee.service';

describe('PayeeService', () => {
  let service: PayeeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PayeeService],
    }).compile();

    service = module.get<PayeeService>(PayeeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
