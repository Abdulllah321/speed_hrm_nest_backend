import { Test, TestingModule } from '@nestjs/testing';
import { PayeeController } from './payee.controller';

describe('PayeeController', () => {
  let controller: PayeeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayeeController],
    }).compile();

    controller = module.get<PayeeController>(PayeeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
