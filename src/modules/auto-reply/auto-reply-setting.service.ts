import {
  Injectable,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';

const RULES_CACHE_TTL_SECONDS = 300;
const LOCK_TTL_MS = 5000;
const RULES_INVALIDATED_CHANNEL = 'assistant_rules:invalidated';

export interface AutoReplySettings {
  enabled: boolean;
  customInstructions: string | null;
}

// Release только если значение всё ещё наше (SET NX не гарантирует, что к
// моменту release лок не истёк и не был перехвачен другим запросом).
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

@Injectable()
export class AutoReplySettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly chatGrpcClient: ChatGrpcClientService,
  ) {}

  async setEnabled(
    userId: string,
    chatId: string,
    enabled: boolean,
    customInstructions?: string,
  ) {
    const isMember = await this.chatGrpcClient.isMember(chatId, userId);
    if (!isMember) {
      throw new ForbiddenException('Вы не состоите в этом чате');
    }

    const trimmed = customInstructions?.trim();
    const normalized = trimmed ? trimmed : null;

    const lockToken = await this.acquireLock(userId, chatId);
    if (!lockToken) {
      throw new ConflictException(
        'Настройки автоответа уже обновляются, повторите через секунду',
      );
    }

    try {
      await this.prisma.autoReplySetting.upsert({
        where: { userId_chatId: { userId, chatId } },
        update: {
          enabled,
          customInstructions: normalized,
          version: { increment: 1 },
        },
        create: { userId, chatId, enabled, customInstructions: normalized },
      });
      await this.invalidateCache(userId, chatId);
    } finally {
      await this.releaseLock(userId, chatId, lockToken);
    }

    return { chatId, enabled, customInstructions: normalized };
  }

  async isEnabled(userId: string, chatId: string): Promise<boolean> {
    const settings = await this.getSettings(userId, chatId);
    return settings.enabled;
  }

  async getSettings(
    userId: string,
    chatId: string,
  ): Promise<AutoReplySettings> {
    const cacheKey = this.cacheKey(userId, chatId);
    const cached = await this.redisService.client.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as AutoReplySettings;
    }

    const setting = await this.prisma.autoReplySetting.findUnique({
      where: { userId_chatId: { userId, chatId } },
    });

    const result: AutoReplySettings = {
      enabled: setting?.enabled ?? false,
      customInstructions: setting?.customInstructions ?? null,
    };
    await this.redisService.client.set(
      cacheKey,
      JSON.stringify(result),
      'EX',
      RULES_CACHE_TTL_SECONDS,
    );
    return result;
  }

  private async invalidateCache(userId: string, chatId: string) {
    // Мгновенная (event-driven) инвалидация: DEL сразу, а не ожидание TTL.
    // TTL на set() в getSettings — только страховка на случай пропущенного DEL.
    await this.redisService.client.del(this.cacheKey(userId, chatId));
    await this.redisService.client.publish(
      RULES_INVALIDATED_CHANNEL,
      JSON.stringify({ userId, chatId }),
    );
  }

  private async acquireLock(
    userId: string,
    chatId: string,
  ): Promise<string | null> {
    const token = randomUUID();
    const acquired = await this.redisService.client.set(
      this.lockKey(userId, chatId),
      token,
      'PX',
      LOCK_TTL_MS,
      'NX',
    );
    return acquired ? token : null;
  }

  private async releaseLock(userId: string, chatId: string, token: string) {
    await this.redisService.client.eval(
      RELEASE_LOCK_SCRIPT,
      1,
      this.lockKey(userId, chatId),
      token,
    );
  }

  private cacheKey(userId: string, chatId: string): string {
    return `assistant_rules:${userId}:${chatId}`;
  }

  private lockKey(userId: string, chatId: string): string {
    return `lock:assistant_rules:${userId}:${chatId}`;
  }
}
