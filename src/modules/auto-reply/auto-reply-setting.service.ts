import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';

@Injectable()
export class AutoReplySettingService {
  constructor(
    private readonly prisma: PrismaService,
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

    await this.prisma.autoReplySetting.upsert({
      where: { userId_chatId: { userId, chatId } },
      update: { enabled, customInstructions: normalized },
      create: { userId, chatId, enabled, customInstructions: normalized },
    });

    return { chatId, enabled, customInstructions: normalized };
  }

  async isEnabled(userId: string, chatId: string): Promise<boolean> {
    const setting = await this.prisma.autoReplySetting.findUnique({
      where: { userId_chatId: { userId, chatId } },
    });

    return setting?.enabled ?? false;
  }

  async getSettings(userId: string, chatId: string) {
    const setting = await this.prisma.autoReplySetting.findUnique({
      where: { userId_chatId: { userId, chatId } },
    });

    return {
      enabled: setting?.enabled ?? false,
      customInstructions: setting?.customInstructions ?? null,
    };
  }
}
