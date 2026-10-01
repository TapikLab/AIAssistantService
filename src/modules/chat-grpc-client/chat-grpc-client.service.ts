import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  ChatInternalService,
  DirectChat,
  RecentMessage,
  SendMessageInternalResponse,
  UnreadChat,
} from './chat-grpc-client.interface';
import { buildInternalGrpcMetadata } from './internal-grpc-metadata';

@Injectable()
export class ChatGrpcClientService implements OnModuleInit {
  private chatInternalService!: ChatInternalService;

  constructor(
    @Inject('CHAT_GRPC_PACKAGE') private readonly client: ClientGrpc,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.chatInternalService =
      this.client.getService<ChatInternalService>('ChatInternal');
  }

  async sendMessageInternal(
    chatId: string,
    senderId: string,
    content: string,
    viaAssistant = false,
  ): Promise<SendMessageInternalResponse> {
    return firstValueFrom(
      this.chatInternalService.sendMessageInternal(
        { chatId, senderId, content, viaAssistant },
        this.metadata(),
      ),
    );
  }

  async isMember(chatId: string, userId: string): Promise<boolean> {
    const response = await firstValueFrom(
      this.chatInternalService.isMember({ chatId, userId }, this.metadata()),
    );
    return response.isMember;
  }

  async getUnreadMessages(
    userId: string,
    maxMessagesPerChat = 20,
  ): Promise<UnreadChat[]> {
    const response = await firstValueFrom(
      this.chatInternalService.getUnreadMessages(
        { userId, maxMessagesPerChat },
        this.metadata(),
      ),
    );
    return response.chats ?? [];
  }

  async getUserMessagesInChat(
    chatId: string,
    userId: string,
    limit = 15,
  ): Promise<string[]> {
    const response = await firstValueFrom(
      this.chatInternalService.getUserMessagesInChat(
        { chatId, userId, limit },
        this.metadata(),
      ),
    );
    return response.messages ?? [];
  }

  async getRecentMessages(
    chatId: string,
    limit = 10,
  ): Promise<RecentMessage[]> {
    const response = await firstValueFrom(
      this.chatInternalService.getRecentMessages(
        { chatId, limit },
        this.metadata(),
      ),
    );
    return response.messages ?? [];
  }

  async getDirectChats(userId: string): Promise<DirectChat[]> {
    const response = await firstValueFrom(
      this.chatInternalService.getDirectChats({ userId }, this.metadata()),
    );
    return response.chats ?? [];
  }

  private metadata() {
    return buildInternalGrpcMetadata(
      this.config.getOrThrow<string>('INTERNAL_API_KEY'),
    );
  }
}
