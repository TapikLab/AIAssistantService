import { Injectable, Logger, Inject } from '@nestjs/common';
import { RedisService } from '@common/redis/redis.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';
import { UserGrpcClientService } from '@modules/user-grpc-client/user-grpc-client.service';
import type { ModelProvider } from '@modules/model-provider/model-provider.interface';

const DIGEST_CACHE_TTL_SECONDS = 120;

export interface DigestResult {
  unreadCount: number;
  summary: string;
}

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly chatGrpcClient: ChatGrpcClientService,
    private readonly userGrpcClient: UserGrpcClientService,
    @Inject('MODEL_PROVIDER') private readonly modelProvider: ModelProvider,
  ) {}

  async getDigest(userId: string): Promise<DigestResult> {
    const cacheKey = `digest:${userId}`;
    const cached = await this.redisService.client.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as DigestResult;
    }

    const unreadChats = await this.chatGrpcClient.getUnreadMessages(userId);
    const unreadCount = unreadChats.reduce(
      (sum, chat) => sum + chat.messages.length,
      0,
    );

    if (unreadCount === 0) {
      const empty: DigestResult = { unreadCount: 0, summary: '' };
      await this.cache(cacheKey, empty);
      return empty;
    }

    const idsToResolve = new Set<string>();
    for (const chat of unreadChats) {
      if (chat.otherMemberId) idsToResolve.add(chat.otherMemberId);
      for (const message of chat.messages) idsToResolve.add(message.senderId);
    }

    const profiles = await this.userGrpcClient.getProfiles([...idsToResolve]);
    const nameById = new Map(profiles.map((p) => [p.userId, p.username]));

    const chatLines = unreadChats.map((chat) => {
      const chatName =
        chat.chatType === 'direct'
          ? (nameById.get(chat.otherMemberId) ?? 'Личный чат')
          : chat.title || 'Групповой чат';

      const messageLines = chat.messages
        .map((m) => `${nameById.get(m.senderId) ?? 'Собеседник'}: ${m.content}`)
        .join('\n');

      return `Чат "${chatName}":\n${messageLines}`;
    });

    const systemPrompt = `Ты помощник, который кратко пересказывает пользователю, что он пропустил в чатах, пока отсутствовал.
          Напиши связный дайджест в 2-4 предложениях на русском языке, сохраняя имена людей и суть просьб/новостей.
          Не используй списки и заголовки — только связный текст.
          Не выдумывай ничего, чего нет в переданных сообщениях.
          Ответ верни строго в формате json с полем "summary".`;

    const userPrompt = chatLines.join('\n\n');

    let summary: string;
    try {
      const rawResponse = await this.modelProvider.generate(
        systemPrompt,
        userPrompt,
      );

      // Парсим JSON от модели (с очисткой markdown-обёрток, если провайдер их добавляет)
      const cleanJson = rawResponse.replace(/```json\s*|```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      summary = (parsed.summary ?? rawResponse).trim();
    } catch (error) {
      this.logger.error(`Не удалось сгенерировать дайджест: ${error}`);
      summary = `У вас ${unreadCount} непрочитанных сообщений.`;
    }

    const result: DigestResult = { unreadCount, summary };
    await this.cache(cacheKey, result);
    return result;
  }

  private async cache(key: string, value: DigestResult) {
    await this.redisService.client.set(
      key,
      JSON.stringify(value),
      'EX',
      DIGEST_CACHE_TTL_SECONDS,
    );
  }
}
