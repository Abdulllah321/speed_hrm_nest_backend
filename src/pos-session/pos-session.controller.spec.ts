import { Test, TestingModule } from '@nestjs/testing';
import { PosSessionController } from './pos-session.controller';

describe('PosSessionController', () => {
  let controller: PosSessionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PosSessionController],
    }).compile();

    controller = module.get<PosSessionController>(PosSessionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
