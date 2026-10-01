import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, PersonalChatRole } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';
import { UserGrpcClientService } from '@modules/user-grpc-client/user-grpc-client.service';
import { AutoReplySettingService } from '@modules/auto-reply/auto-reply-setting.service';
import {
  AssistantIntentType,
  INTENT_CONFIDENCE_THRESHOLD,
  IntentParserService,
  ParsedIntent,
  SetAutoReplyIntent,
} from './intent-parser.service';
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto';
import { AssistantMessageResponse } from './dto/assistant-message-response.dto';

const CLARIFY_NO_INTENT =
  'Не понял команду. Опишите, для какого собеседника и что настроить с авто-ответом, например: «включи авто-ответ для Ани».';
const CLARIFY_NO_CHATS =
  'У вас пока нет личных чатов с другими пользователями.';
const CLARIFY_UPDATE_BUSY =
  'Настройки для этого чата уже обновляются, повторите команду через секунду.';

@Injectable()
export class PersonalChatService {
  private readonly logger = new Logger(PersonalChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGrpcClient: ChatGrpcClientService,
    private readonly userGrpcClient: UserGrpcClientService,
    private readonly autoReplySettingService: AutoReplySettingService,
    private readonly intentParser: IntentParserService,
  ) {}

  async sendMessage(
    userId: string,
    dto: SendAssistantMessageDto,
  ): Promise<AssistantMessageResponse> {
    const existing = dto.clientMessageId
      ? await this.findByClientMessageId(userId, dto.clientMessageId)
      : null;
    if (existing) return existing;

    const userMessage = await this.saveMessage(userId, {
      role: PersonalChatRole.USER,
      content: dto.content,
      ...(dto.attachments && {
        attachments: dto.attachments as unknown as Prisma.InputJsonValue,
      }),
      ...(dto.clientMessageId && { clientMessageId: dto.clientMessageId }),
    });

    const intent = await this.intentParser.parse(dto.content);
    const response = await this.handleIntent(userId, intent);

    await this.saveMessage(userId, {
      role: PersonalChatRole.ASSISTANT,
      content: response.reply,
      intent: intent as unknown as Prisma.InputJsonValue,
    });

    return { ...response, messageId: userMessage.id };
  }

  async getHistory(userId: string, cursor?: string, limit = 30) {
    const messages = await this.prisma.personalChatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    return {
      messages: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  private async handleIntent(
    userId: string,
    intent: ParsedIntent,
  ): Promise<Omit<AssistantMessageResponse, 'messageId'>> {
    if (
      intent.type !== AssistantIntentType.SET_AUTO_REPLY ||
      intent.confidence < INTENT_CONFIDENCE_THRESHOLD
    ) {
      return {
        reply: CLARIFY_NO_INTENT,
        action: { type: 'CLARIFICATION_NEEDED' },
      };
    }

    const resolution = await this.resolveParticipant(
      userId,
      intent.participantNameQuery,
    );
    if (resolution.type !== 'resolved') {
      return {
        reply: resolution.message,
        action: { type: 'CLARIFICATION_NEEDED' },
      };
    }

    const enabled = intent.enabled ?? true;

    try {
      await this.autoReplySettingService.setEnabled(
        userId,
        resolution.chatId,
        enabled,
        intent.customInstructions,
      );
    } catch (error) {
      this.logger.error(`Не удалось применить правило авто-ответа: ${error}`);
      const message =
        error instanceof ConflictException
          ? CLARIFY_UPDATE_BUSY
          : 'Не удалось обновить настройки, попробуйте ещё раз чуть позже.';
      return { reply: message, action: { type: 'NONE' } };
    }

    await this.writeAuditLog(userId, resolution.chatId, enabled, intent);

    const reply = enabled
      ? `Готово, авто-ответ для ${resolution.participantName} включён${
          intent.customInstructions ? ' с вашими инструкциями' : ''
        }.`
      : `Готово, авто-ответ для ${resolution.participantName} выключен.`;

    return {
      reply,
      action: {
        type: 'AUTO_REPLY_UPDATED',
        targetChatId: resolution.chatId,
        enabled,
      },
    };
  }

  private async resolveParticipant(
    userId: string,
    nameQuery: string,
  ): Promise<
    | { type: 'resolved'; chatId: string; participantName: string }
    | { type: 'ambiguous' | 'not_found'; message: string }
  > {
    const directChats = await this.chatGrpcClient.getDirectChats(userId);
    if (directChats.length === 0) {
      return { type: 'not_found', message: CLARIFY_NO_CHATS };
    }

    const profiles = await this.userGrpcClient.getProfiles(
      directChats.map((c) => c.otherMemberId),
    );
    const profileById = new Map(profiles.map((p) => [p.userId, p.username]));

    const normalizedQuery = nameQuery.trim().toLowerCase();
    const matches = directChats
      .map((chat) => ({
        chatId: chat.chatId,
        participantName: profileById.get(chat.otherMemberId) ?? '',
      }))
      .filter(
        (m) =>
          m.participantName &&
          m.participantName.toLowerCase().includes(normalizedQuery),
      );

    if (matches.length === 0) {
      return {
        type: 'not_found',
        message: `Не нашёл собеседника с именем «${nameQuery}» среди ваших личных чатов.`,
      };
    }
    if (matches.length > 1) {
      const names = matches.map((m) => m.participantName).join(', ');
      return {
        type: 'ambiguous',
        message: `Нашёл несколько собеседников с похожим именем: ${names}. Уточните, кого именно вы имели в виду.`,
      };
    }

    return { type: 'resolved', ...matches[0] };
  }

  private async writeAuditLog(
    userId: string,
    targetChatId: string,
    enabled: boolean,
    intent: SetAutoReplyIntent,
  ) {
    await this.prisma.assistantRuleAuditLog.create({
      data: {
        userId,
        targetChatId,
        action: enabled ? 'auto_reply.enabled' : 'auto_reply.disabled',
        payload: {
          enabled,
          customInstructions: intent.customInstructions ?? null,
        },
      },
    });
  }

  private async findByClientMessageId(
    userId: string,
    clientMessageId: string,
  ): Promise<AssistantMessageResponse | null> {
    const userMessage = await this.prisma.personalChatMessage.findUnique({
      where: { userId_clientMessageId: { userId, clientMessageId } },
    });
    if (!userMessage) return null;

    const assistantReply = await this.prisma.personalChatMessage.findFirst({
      where: {
        userId,
        role: PersonalChatRole.ASSISTANT,
        createdAt: { gt: userMessage.createdAt },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      messageId: userMessage.id,
      reply: assistantReply?.content ?? '',
      action: { type: 'NONE' },
    };
  }

  private saveMessage(
    userId: string,
    data: {
      role: PersonalChatRole;
      content: string;
      attachments?: Prisma.InputJsonValue;
      intent?: Prisma.InputJsonValue;
      clientMessageId?: string;
    },
  ) {
    return this.prisma.personalChatMessage.create({
      data: { userId, ...data },
    });
  }
}
