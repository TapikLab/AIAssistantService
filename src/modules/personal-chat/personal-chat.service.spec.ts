import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PersonalChatService } from './personal-chat.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';
import { UserGrpcClientService } from '@modules/user-grpc-client/user-grpc-client.service';
import { AutoReplySettingService } from '@modules/auto-reply/auto-reply-setting.service';
import {
  AssistantIntentType,
  IntentParserService,
} from './intent-parser.service';

interface AuditLogCreateArgs {
  data: { userId: string; targetChatId: string; action: string };
}

describe('PersonalChatService', () => {
  let service: PersonalChatService;
  let prisma: {
    personalChatMessage: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    assistantRuleAuditLog: {
      create: jest.Mock<Promise<unknown>, [AuditLogCreateArgs]>;
    };
  };
  let chatGrpcClient: { getDirectChats: jest.Mock };
  let userGrpcClient: { getProfiles: jest.Mock };
  let autoReplySettingService: { setEnabled: jest.Mock };
  let intentParser: { parse: jest.Mock };

  beforeEach(async () => {
    prisma = {
      personalChatMessage: {
        create: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => ({
            id: 'msg-1',
            createdAt: new Date(),
            ...args.data,
          })),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      assistantRuleAuditLog: {
        create: jest.fn<Promise<unknown>, [AuditLogCreateArgs]>(),
      },
    };
    chatGrpcClient = { getDirectChats: jest.fn() };
    userGrpcClient = { getProfiles: jest.fn() };
    autoReplySettingService = { setEnabled: jest.fn() };
    intentParser = { parse: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatGrpcClientService, useValue: chatGrpcClient },
        { provide: UserGrpcClientService, useValue: userGrpcClient },
        { provide: AutoReplySettingService, useValue: autoReplySettingService },
        { provide: IntentParserService, useValue: intentParser },
      ],
    }).compile();

    service = module.get<PersonalChatService>(PersonalChatService);
  });

  it('запрашивает уточнение, если намерение не распознано', async () => {
    intentParser.parse.mockResolvedValue({
      type: AssistantIntentType.UNKNOWN,
      confidence: 0,
    });

    const result = await service.sendMessage('user-1', { content: 'привет' });

    expect(result.action.type).toBe('CLARIFICATION_NEEDED');
    expect(autoReplySettingService.setEnabled).not.toHaveBeenCalled();
  });

  it('запрашивает уточнение, если найдено несколько собеседников с похожим именем', async () => {
    intentParser.parse.mockResolvedValue({
      type: AssistantIntentType.SET_AUTO_REPLY,
      participantNameQuery: 'Ан',
      enabled: true,
      confidence: 0.9,
    });
    chatGrpcClient.getDirectChats.mockResolvedValue([
      { chatId: 'chat-1', otherMemberId: 'user-a' },
      { chatId: 'chat-2', otherMemberId: 'user-b' },
    ]);
    userGrpcClient.getProfiles.mockResolvedValue([
      { userId: 'user-a', username: 'Ани', avatarUrl: '' },
      { userId: 'user-b', username: 'Анна', avatarUrl: '' },
    ]);

    const result = await service.sendMessage('user-1', {
      content: 'включи авто-ответ для Ан',
    });

    expect(result.action.type).toBe('CLARIFICATION_NEEDED');
    expect(result.reply).toContain('Ани');
    expect(result.reply).toContain('Анна');
    expect(autoReplySettingService.setEnabled).not.toHaveBeenCalled();
  });

  it('включает авто-ответ, когда собеседник однозначно найден', async () => {
    intentParser.parse.mockResolvedValue({
      type: AssistantIntentType.SET_AUTO_REPLY,
      participantNameQuery: 'Ани',
      enabled: true,
      customInstructions: 'скажи, что я занят',
      confidence: 0.95,
    });
    chatGrpcClient.getDirectChats.mockResolvedValue([
      { chatId: 'chat-1', otherMemberId: 'user-a' },
    ]);
    userGrpcClient.getProfiles.mockResolvedValue([
      { userId: 'user-a', username: 'Ани', avatarUrl: '' },
    ]);
    autoReplySettingService.setEnabled.mockResolvedValue({});

    const result = await service.sendMessage('user-1', {
      content: 'включи авто-ответ для Ани, скажи что я занят',
    });

    expect(autoReplySettingService.setEnabled).toHaveBeenCalledWith(
      'user-1',
      'chat-1',
      true,
      'скажи, что я занят',
    );
    expect(result.action).toEqual({
      type: 'AUTO_REPLY_UPDATED',
      targetChatId: 'chat-1',
      enabled: true,
    });
    const auditCall = prisma.assistantRuleAuditLog.create.mock.calls[0][0];
    expect(auditCall.data).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        targetChatId: 'chat-1',
        action: 'auto_reply.enabled',
      }),
    );
  });

  it('отвечает вежливым fallback, если правило занято параллельным обновлением (lock conflict)', async () => {
    intentParser.parse.mockResolvedValue({
      type: AssistantIntentType.SET_AUTO_REPLY,
      participantNameQuery: 'Ани',
      enabled: true,
      confidence: 0.9,
    });
    chatGrpcClient.getDirectChats.mockResolvedValue([
      { chatId: 'chat-1', otherMemberId: 'user-a' },
    ]);
    userGrpcClient.getProfiles.mockResolvedValue([
      { userId: 'user-a', username: 'Ани', avatarUrl: '' },
    ]);
    autoReplySettingService.setEnabled.mockRejectedValue(
      new ConflictException('lock busy'),
    );

    const result = await service.sendMessage('user-1', {
      content: 'включи авто-ответ для Ани',
    });

    expect(result.action).toEqual({ type: 'NONE' });
    expect(result.reply).toMatch(/повтор/i);
    expect(prisma.assistantRuleAuditLog.create).not.toHaveBeenCalled();
  });

  it('идемпотентно возвращает прежний ответ при повторной отправке с тем же clientMessageId', async () => {
    const createdAt = new Date();
    prisma.personalChatMessage.findUnique.mockResolvedValue({
      id: 'msg-existing',
      createdAt,
    });
    prisma.personalChatMessage.findFirst.mockResolvedValue({
      content: 'Готово, авто-ответ для Ани включён.',
    });

    const result = await service.sendMessage('user-1', {
      content: 'включи авто-ответ для Ани',
      clientMessageId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result).toEqual({
      messageId: 'msg-existing',
      reply: 'Готово, авто-ответ для Ани включён.',
      action: { type: 'NONE' },
    });
    expect(intentParser.parse).not.toHaveBeenCalled();
    expect(prisma.personalChatMessage.create).not.toHaveBeenCalled();
  });
});
