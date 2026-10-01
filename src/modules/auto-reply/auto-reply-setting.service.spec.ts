import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AutoReplySettingService } from './auto-reply-setting.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';

interface UpsertArgs {
  where: { userId_chatId: { userId: string; chatId: string } };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}

describe('AutoReplySettingService', () => {
  let service: AutoReplySettingService;
  let redisClient: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    publish: jest.Mock;
    eval: jest.Mock;
  };
  let prisma: {
    autoReplySetting: {
      findUnique: jest.Mock;
      upsert: jest.Mock<Promise<unknown>, [UpsertArgs]>;
    };
  };
  let chatGrpcClient: { isMember: jest.Mock };

  beforeEach(async () => {
    redisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      publish: jest.fn(),
      eval: jest.fn(),
    };
    prisma = {
      autoReplySetting: {
        findUnique: jest.fn(),
        upsert: jest.fn<Promise<unknown>, [UpsertArgs]>(),
      },
    };
    chatGrpcClient = { isMember: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoReplySettingService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: { client: redisClient } },
        { provide: ChatGrpcClientService, useValue: chatGrpcClient },
      ],
    }).compile();

    service = module.get<AutoReplySettingService>(AutoReplySettingService);
  });

  describe('getSettings', () => {
    it('возвращает значение из кэша и не ходит в БД при попадании', async () => {
      redisClient.get.mockResolvedValue(
        JSON.stringify({ enabled: true, customInstructions: 'привет' }),
      );

      const result = await service.getSettings('user-1', 'chat-1');

      expect(result).toEqual({ enabled: true, customInstructions: 'привет' });
      expect(prisma.autoReplySetting.findUnique).not.toHaveBeenCalled();
    });

    it('при промахе кэша читает БД и прогревает кэш с TTL', async () => {
      redisClient.get.mockResolvedValue(null);
      prisma.autoReplySetting.findUnique.mockResolvedValue({
        enabled: false,
        customInstructions: null,
      });

      const result = await service.getSettings('user-1', 'chat-1');

      expect(result).toEqual({ enabled: false, customInstructions: null });
      expect(redisClient.set).toHaveBeenCalledWith(
        'assistant_rules:user-1:chat-1',
        JSON.stringify(result),
        'EX',
        300,
      );
    });
  });

  describe('setEnabled', () => {
    it('бросает ForbiddenException, если пользователь не состоит в чате', async () => {
      chatGrpcClient.isMember.mockResolvedValue(false);

      await expect(
        service.setEnabled('user-1', 'chat-1', true),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('обновляет настройку, инвалидирует кэш моментально и снимает лок', async () => {
      redisClient.set.mockResolvedValueOnce('OK'); // acquireLock (NX)
      prisma.autoReplySetting.upsert.mockResolvedValue({});

      await service.setEnabled('user-1', 'chat-1', true, ' будь краток ');

      const call = prisma.autoReplySetting.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_chatId: { userId: 'user-1', chatId: 'chat-1' },
      });
      expect(call.update).toEqual({
        enabled: true,
        customInstructions: 'будь краток',
        version: { increment: 1 },
      });
      // Событийная инвалидация: DEL сразу, без ожидания TTL.
      expect(redisClient.del).toHaveBeenCalledWith(
        'assistant_rules:user-1:chat-1',
      );
      expect(redisClient.publish).toHaveBeenCalledWith(
        'assistant_rules:invalidated',
        JSON.stringify({ userId: 'user-1', chatId: 'chat-1' }),
      );
      expect(redisClient.eval).toHaveBeenCalled(); // releaseLock
    });

    it('бросает ConflictException, когда лок уже занят конкурентным запросом', async () => {
      redisClient.set.mockResolvedValueOnce(null); // NX не сработал — лок занят

      await expect(
        service.setEnabled('user-1', 'chat-1', true),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.autoReplySetting.upsert).not.toHaveBeenCalled();
    });

    it('снимает лок даже если upsert упал с ошибкой', async () => {
      redisClient.set.mockResolvedValueOnce('OK');
      prisma.autoReplySetting.upsert.mockRejectedValue(new Error('db down'));

      await expect(
        service.setEnabled('user-1', 'chat-1', true),
      ).rejects.toThrow('db down');
      expect(redisClient.eval).toHaveBeenCalled();
    });
  });
});
