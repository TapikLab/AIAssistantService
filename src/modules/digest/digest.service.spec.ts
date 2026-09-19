import { Test, TestingModule } from '@nestjs/testing';
import { DigestService } from './digest.service';
import { RedisService } from '@common/redis/redis.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';
import { UserGrpcClientService } from '@modules/user-grpc-client/user-grpc-client.service';
describe('DigestService', () => {
  let service: DigestService;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigestService,
        {
          provide: RedisService,
          useValue: { client: { get: jest.fn(), set: jest.fn() } },
        },
        { provide: ChatGrpcClientService, useValue: {} },
        { provide: UserGrpcClientService, useValue: {} },
        { provide: 'MODEL_PROVIDER', useValue: { generate: jest.fn() } },
      ],
    }).compile();
    service = module.get<DigestService>(DigestService);
  });
  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
