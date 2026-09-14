import { Test, TestingModule } from '@nestjs/testing';
import { DigestService } from './digest.service';

describe('DigestService', () => {
  let service: DigestService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DigestService],
    }).compile();

    service = module.get<DigestService>(DigestService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
