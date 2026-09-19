import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@common/redis/redis.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';

const LOCK_KEY = 'assistant:schedule-runner:lock';
const LOCK_TTL_MS = 25_000;
const CLEANUP_LOCK_KEY = 'assistant:schedule-cleanup:lock';
const CLEANUP_LOCK_TTL_MS = 25_000;
const TERMINAL_MESSAGE_RETENTION_DAYS = 30;

@Injectable()
export class ScheduleRunnerService {
  private readonly logger = new Logger(ScheduleRunnerService.name);
  private readonly instanceId = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly chatGrpcClient: ChatGrpcClientService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processDueMessages() {
    const acquired = await this.redisService.client.set(
      LOCK_KEY,
      this.instanceId,
      'PX',
      LOCK_TTL_MS,
      'NX',
    );
    if (!acquired) {
      return;
    }

    try {
      const due = await this.prisma.scheduledMessage.findMany({
        where: { status: 'pending', sendAt: { lte: new Date() } },
        orderBy: { sendAt: 'asc' },
        take: 50,
      });

      let processed = 0;
      for (const message of due) {
        const claimed = await this.prisma.scheduledMessage.updateMany({
          where: { id: message.id, status: 'pending' },
          data: { status: 'processing' },
        });
        if (claimed.count === 0) continue;

        try {
          await this.processMessage(message);
          processed++;
        } catch (error) {
          await this.prisma.scheduledMessage
            .updateMany({
              where: { id: message.id, status: 'processing' },
              data: { status: 'pending' },
            })
            .catch(() => undefined);

          this.logger.error(
            `Не удалось обработать отложенное сообщение ${message.id}: ${error}`,
          );
        }
      }

      if (processed > 0) {
        this.logger.log(`Обработано отложенных сообщений: ${processed}`);
      }
    } finally {
      await this.releaseLockIfOwned();
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeTerminalMessages(): Promise<void> {
    const acquired = await this.redisService.client.set(
      CLEANUP_LOCK_KEY,
      this.instanceId,
      'PX',
      CLEANUP_LOCK_TTL_MS,
      'NX',
    );
    if (!acquired) return;

    try {
      const cutoff = new Date(
        Date.now() - TERMINAL_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const { count } = await this.prisma.scheduledMessage.deleteMany({
        where: {
          status: { in: ['sent', 'failed', 'cancelled'] },
          createdAt: { lt: cutoff },
        },
      });
      if (count > 0) {
        this.logger.log(`Удалено завершённых отложенных сообщений: ${count}`);
      }
    } finally {
      await this.redisService.client.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        CLEANUP_LOCK_KEY,
        this.instanceId,
      );
    }
  }

  private async processMessage(message: {
    id: string;
    chatId: string;
    userId: string;
    content: string;
  }) {
    const stillMember = await this.chatGrpcClient.isMember(
      message.chatId,
      message.userId,
    );

    if (!stillMember) {
      await this.prisma.scheduledMessage.update({
        where: { id: message.id },
        data: {
          status: 'failed',
          error: 'Пользователь больше не состоит в этом чате',
        },
      });
      return;
    }

    const result = await this.chatGrpcClient.sendMessageInternal(
      message.chatId,
      message.userId,
      message.content,
    );

    await this.prisma.scheduledMessage.update({
      where: { id: message.id },
      data: result.success
        ? { status: 'sent', sentAt: new Date() }
        : { status: 'failed', error: result.error },
    });
  }

  private async releaseLockIfOwned(): Promise<void> {
    await this.redisService.client.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      LOCK_KEY,
      this.instanceId,
    );
  }
}
