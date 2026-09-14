import { Test, TestingModule } from '@nestjs/testing';
import { DigestController } from './digest.controller';

describe('DigestController', () => {
  let controller: DigestController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DigestController],
    }).compile();

    controller = module.get<DigestController>(DigestController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
