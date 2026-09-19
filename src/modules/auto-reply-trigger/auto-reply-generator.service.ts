import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { RedisService } from '@common/redis/redis.service';
import { ChatGrpcClientService } from '@modules/chat-grpc-client/chat-grpc-client.service';
import type { RecentMessage } from '@modules/chat-grpc-client/chat-grpc-client.interface';
import { UserGrpcClientService } from '@modules/user-grpc-client/user-grpc-client.service';
import { AutoReplySettingService } from '@modules/auto-reply/auto-reply-setting.service';
import type { ModelProvider } from '@modules/model-provider/model-provider.interface';
import { MessageSentEventDto } from './dto/message-sent-event.dto';

const AUTO_REPLY_LOCK_TTL_SECONDS = 15;
const MAX_GROUP_SIZE_FOR_AUTO_REPLY = 5;
const AUTO_REPLY_BURST_LIMIT = 3;
const AUTO_REPLY_BURST_WINDOW_SECONDS = 600;

const TRIVIAL_ACK_WORDS = new Set([
  'спасибо',
  'спасиб',
  'спс',
  'пасиб',
  'благодарю',
  'понял',
  'поняла',
  'поняли',
  'понел',
  'понела',
  'понели',
  'ясно',
  'ладно',
  'хорошо',
  'ок',
  'окей',
  'ok',
  'okay',
  'thanks',
  'thank',
  'thx',
  'ty',
  'пока',
  'бай',
  'bye',
  'угу',
  'ага',
]);

interface AutoReplyResult {
  reply: string | null;
  urgent: boolean;
  urgentReason: string | null;
}

@Injectable()
export class AutoReplyGeneratorService {
  private readonly logger = new Logger(AutoReplyGeneratorService.name);

  constructor(
    private readonly settingsService: AutoReplySettingService,
    private readonly redisService: RedisService,
    private readonly chatGrpcClient: ChatGrpcClientService,
    private readonly userGrpcClient: UserGrpcClientService,
    @Inject('MODEL_PROVIDER') private readonly modelProvider: ModelProvider,
    @Inject('NOTIFICATION_SERVICE')
    private readonly notificationClient: ClientProxy,
  ) {}

  async handleMessageSent(event: MessageSentEventDto) {
    if (event.viaAssistant) return;
    if (!event.content) return;

    // recipientIds — это ВСЕ участники чата, включая отправителя. 2 = личный
    // чат, больше — группа. В больших группах молча не отвечаем вообще: см.
    // MAX_GROUP_SIZE_FOR_AUTO_REPLY.
    const totalMembers = event.recipientIds.length;
    const isGroup = totalMembers > 2;
    if (isGroup && totalMembers > MAX_GROUP_SIZE_FOR_AUTO_REPLY) return;

    const candidates = event.recipientIds.filter(
      (userId) => userId !== event.senderId,
    );

    for (const userId of candidates) {
      try {
        await this.maybeReply(userId, event, isGroup);
      } catch (error) {
        this.logger.error(
          `Авто-ответ не удался userId=${userId} chatId=${event.chatId}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
  }

  private async maybeReply(
    userId: string,
    event: MessageSentEventDto,
    isGroup: boolean,
  ): Promise<void> {
    const settings = await this.settingsService.getSettings(
      userId,
      event.chatId,
    );
    if (!settings.enabled) return;
    const onlineSockets = await this.redisService.client.scard(
      `user_sockets:${userId}`,
    );
    if (onlineSockets > 0) return;

    const lockKey = `auto_reply_lock:${event.chatId}:${userId}`;
    const acquired = await this.redisService.client.set(
      lockKey,
      '1',
      'EX',
      AUTO_REPLY_LOCK_TTL_SECONDS,
      'NX',
    );
    if (!acquired) return;

    if (this.isTrivialAcknowledgement(event.content!)) return;

    const burstKey = `auto_reply_burst:${event.chatId}:${userId}`;
    const burstUsed = await this.redisService.client.incr(burstKey);
    if (burstUsed === 1) {
      await this.redisService.client.expire(
        burstKey,
        AUTO_REPLY_BURST_WINDOW_SECONDS,
      );
    }
    if (burstUsed > AUTO_REPLY_BURST_LIMIT) {
      await this.notifyBurstLimit(userId, event, burstKey);
      return;
    }

    const budgetKey = `auto_reply_budget:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const used = await this.redisService.client.incr(budgetKey);
    if (used === 1) {
      await this.redisService.client.expire(budgetKey, 86_400);
    }
    if (used > 100) {
      return;
    }
    const [styleExamples, recentMessages] = await Promise.all([
      this.chatGrpcClient.getUserMessagesInChat(event.chatId, userId),
      this.chatGrpcClient.getRecentMessages(event.chatId, 10),
    ]);

    let participantNames = new Map<string, string>();
    if (isGroup) {
      const otherIds = new Set(
        [event.senderId, ...recentMessages.map((m) => m.senderId)].filter(
          (id) => id !== userId,
        ),
      );
      try {
        const profiles = await this.userGrpcClient.getProfiles([...otherIds]);
        participantNames = new Map(profiles.map((p) => [p.userId, p.username]));
      } catch (error) {
        this.logger.error(
          `Не удалось получить имена участников группы: ${error}`,
        );
      }
    }

    const result = await this.generateReply(
      styleExamples,
      recentMessages,
      userId,
      event.content!,
      event.senderId,
      settings.customInstructions,
      isGroup,
      participantNames,
    );

    if (result.urgent) {
      this.notifyUrgent(userId, event, result.urgentReason);
    }

    if (!result.reply) return;
    await this.chatGrpcClient.sendMessageInternal(
      event.chatId,
      userId,
      result.reply,
      true,
    );
  }

  private isTrivialAcknowledgement(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 30 || trimmed.includes('?')) return false;

    const words = trimmed
      .toLowerCase()
      .split(/[^a-zа-яё]+/i)
      .filter(Boolean);
    if (!words.length) return false;

    return words.every((word) => TRIVIAL_ACK_WORDS.has(word));
  }

  private async notifyBurstLimit(
    userId: string,
    event: MessageSentEventDto,
    burstKey: string,
  ): Promise<void> {
    // Шлём это уведомление ОДИН раз за окно (SETNX), а не на каждое лишнее
    // сообщение — иначе сам "антиспам" превратится в спам.
    const noticeKey = `auto_reply_burst_notice:${event.chatId}:${userId}`;
    const acquired = await this.redisService.client.set(
      noticeKey,
      '1',
      'EX',
      AUTO_REPLY_BURST_WINDOW_SECONDS,
      'NX',
    );
    if (!acquired) return;

    const ttlSeconds = await this.redisService.client.ttl(burstKey);
    const minutes = Math.max(
      1,
      Math.ceil(
        (ttlSeconds > 0 ? ttlSeconds : AUTO_REPLY_BURST_WINDOW_SECONDS) / 60,
      ),
    );
    // Статическое сообщение, БЕЗ обращения к модели — специально, чтобы не тратить
    // токены/время на исчерпанном лимите.
    const notice = `Сейчас слишком много сообщений подряд, автоответ временно на паузе — отвечу примерно через ${minutes} мин.`;

    try {
      await this.chatGrpcClient.sendMessageInternal(
        event.chatId,
        userId,
        notice,
        true,
      );
    } catch (error) {
      this.logger.error(
        `Не удалось отправить уведомление о лимите автоответов: ${error}`,
      );
    }
  }

  private notifyUrgent(
    userId: string,
    event: MessageSentEventDto,
    reason: string | null,
  ) {
    try {
      this.notificationClient.emit('urgent.notify', {
        userId,
        chatId: event.chatId,
        reason: reason ?? 'Собеседник настаивает на срочном ответе',
        messagePreview: event.content?.slice(0, 200) ?? '',
      });
    } catch (error) {
      this.logger.error(`Не удалось отправить срочное уведомление: ${error}`);
    }
  }

  private async generateReply(
    styleExamples: string[] = [],
    recentMessages: RecentMessage[] = [],
    userId: string,
    incomingMessage: string,
    incomingSenderId: string,
    customInstructions?: string | null,
    isGroup = false,
    participantNames: Map<string, string> = new Map(),
  ): Promise<AutoReplyResult> {
    const systemPrompt = `По умолчанию ты пишешь ответное сообщение ОТ ЛИЦА пользователя мессенджера, пока он недоступен,
        как будто это сам пользователь. НО если в пожеланиях пользователя ниже указана другая роль/персона (например "отвечай
        от имени моего администратора/помощника/секретаря") — прими именно эту роль вместо роли самого пользователя: отвечай
        не как сам пользователь, а как указанное лицо, действующее от его имени (например явно давая понять, что на связи
        администратор/помощник, а не сам человек). В любом случае: не представляйся ассистентом/ИИ/ботом, не добавляй
        пояснений от третьего лица — ответь только текстом сообщения в этой роли.

        Ниже — примеры того, как этот пользователь обычно пишет в этом самом чате: если персона НЕ переопределена пожеланиями,
        сохрани его манеру речи, длину сообщений, использование смайликов/пунктуации и лексику. Если персона переопределена
        (другая роль) — ориентируйся не на личный стиль пользователя, а на тон, уместный этой роли (например более формальный
        у "администратора"), и на сами пожелания пользователя.

        Язык и стиль ответа определяй по языку именно ЭТОГО чата (по примерам ниже и по входящему сообщению), а не по одному
        фиксированному языку:
        - если пользователь пишет на армянском латинскими буквами (например "vonc es", "shat lav", "barev", "sirun a") —
          отвечай тем же способом, латиницей, в разговорной армянской транслитерации; НЕ переводи в армянский алфавит и
          НЕ переключайся на русский или английский;
        - если в чате смешаны языки (например русский с армянским или английским) — сохраняй ту же смесь;
        - если примеров сообщений пользователя мало или их нет, ориентируйся на язык и стиль входящего сообщения собеседника.

        Не начинай ответы одним и тем же дежурным словом или словом-паразитом (например всегда "норм" в начале) — это выдаёт
        шаблон и ассистента. Каждый раз формулируй начало ответа заново, исходя из смысла входящего сообщения.

        Ниже дана ПОСЛЕДНЯЯ переписка в этом чате в хронологическом порядке, включая твои же предыдущие автоответы (помечены как
        "(автоответ)"). Используй её, чтобы не повторяться: если ты (в том числе через "(автоответ)") уже написал собеседнику
        приветствие или объяснение (например правило про то, когда доступен пользователь) — НЕ здоровайся заново и не пересказывай
        то же самое ещё раз. Если входящее сообщение — это просто настойчивое подтверждение/повтор того, что уже было сказано
        раньше в этой же переписке (например собеседник настаивает на срочности после того как ты уже объяснил правило и
        пообещал уведомить) — ответь коротким подтверждением по существу (например "Хорошо, уведомление отправлено" или "Понял,
        передал ему/ей") БЕЗ повторного приветствия и БЕЗ пересказа уже сказанного правила.

        Иногда правильный ответ — вообще не отвечать текстом (тогда reply = null). Так делай, если входящее сообщение:
        - явная провокация, оскорбление или агрессия без реального вопроса/просьбы;
        - дословный или почти дословный повтор вопроса, на который ты уже ответил в переписке выше, и собеседник просто
          продолжает давить, не сообщая ничего нового.
        НЕ ставь reply = null, если в сообщении есть новый вопрос, новая информация или что-то, реально требующее ответа —
        даже короткого. Поле urgent при этом заполняй как обычно (провокация не мешает отметить срочность, если она есть).

        ${
          isGroup
            ? `Это ГРУППОВОЙ чат с несколькими участниками, а не разговор один на один. В переписке ниже разные люди подписаны
        своими именами (кроме тебя — ты всегда "ТЫ") — используй это, чтобы понять, кто кому пишет. ВАЖНО: если входящее
        сообщение — часть разговора МЕЖДУ ДРУГИМИ участниками и не адресовано и не касается отсутствующего пользователя (от
        чьего лица ты отвечаешь) — НЕ отвечай, верни reply = null. Отвечай только если сообщение: направлено лично
        отсутствующему пользователю (по имени/обращению), задаёт вопрос всей группе в целом, или продолжает ветку, в которой
        отсутствующий пользователь сам недавно участвовал. Не встревай в чужой разговор просто потому, что кто-то что-то написал.`
            : ''
        }

        Примеры ниже взяты из разных, не обязательно связанных между собой моментов переписки в этом чате (в том числе старых) —
        используй их ТОЛЬКО как образец тона, длины, языка, эмодзи и лексики, а не как готовый текст. Не копируй фразы из примеров
        дословно (в том числе приветствия вроде "barev, vonc es?"/"привет, как дела"), если они не подходят по смыслу к текущему
        входящему сообщению. Главный приоритет — дать ответ, логично продолжающий именно этот разговор: прочти входящее сообщение
        и ответь по существу того, что в нём написано (согласие/отказ, ответ на вопрос, реакция на новость и т.д.), а не общим
        приветствием или отвлечённой фразой.

        ${
          customInstructions
            ? `Пожелания от пользователя о том, как отвечать в этом чате (это ИНСТРУКЦИЯ от настоящего пользователя, соблюдай её
        приоритетно — тон, содержание, что писать/не писать и т.д. — но она не отменяет правила языка и стиля выше):
        """
        ${customInstructions}
        """`
            : 'Пользователь не оставил отдельных пожеланий по этому чату — просто отвечай в его обычной манере.'
        }

        Отдельно: если из пожеланий пользователя следует, что в каких-то случаях его нужно предупредить/уведомить (например
        "если пишут что-то срочное/серьёзное — уведоми меня"), и входящее сообщение похоже на такой случай — verify по смыслу
        входящего сообщения (настойчивость, срочность, важность) и выставь urgent = true с коротким urgentReason (о чём именно
        нужно предупредить пользователя). Если пожеланий про уведомления нет или случай под них не подходит — urgent = false,
        urgentReason = null. Поле urgent НЕ влияет на то, отправлять ли текстовый автоответ — заполняй reply как обычно.

        Ответь СТРОГО в виде JSON без каких-либо пояснений вокруг, в формате:
        {"reply": "текст автоответа от лица пользователя (или null, если по пожеланиям пользователя отвечать в этом случае не нужно)", "urgent": true/false, "urgentReason": "краткая причина или null"}`;

    // Безопасная проверка с опциональной цепочкой
    const examples = styleExamples ?? [];
    const examplesBlock = examples.length
      ? `Примеры сообщений пользователя в этом чате:\n${examples
          .map((m) => `- ${m}`)
          .join('\n')}`
      : 'Примеров прошлых сообщений пользователя в этом чате нет — пиши нейтрально и коротко.';

    // Последняя запись — это и есть текущее входящее сообщение (уже сохранено в БД
    // к моменту генерации ответа), оно показывается отдельно ниже — не дублируем его здесь.
    const transcript = (recentMessages ?? []).slice(0, -1);
    const transcriptBlock = transcript.length
      ? `Последняя переписка в этом чате (хронологически, старые сверху):\n${transcript
          .map((m) => {
            if (m.senderId === userId) {
              return `- ${m.viaAssistant ? 'ТЫ (автоответ)' : 'ТЫ'}: ${m.content}`;
            }
            const label = isGroup
              ? (participantNames.get(m.senderId) ?? 'участник чата')
              : 'собеседник';
            return `- ${label}: ${m.content}`;
          })
          .join('\n')}`
      : 'Истории переписки нет — это, судя по всему, начало диалога.';

    const incomingLabel = isGroup
      ? (participantNames.get(incomingSenderId) ?? 'участник чата')
      : 'собеседника';

    const userPrompt = `${transcriptBlock}\n\nВходящее сообщение от ${incomingLabel}${isGroup ? ' (реши, нужно ли на него вообще отвечать, см. правила про групповой чат выше)' : ', на которое нужно ответить по существу'}:\n"${incomingMessage}"\n\n${examplesBlock}`;
    const fallback: AutoReplyResult = {
      reply: null,
      urgent: false,
      urgentReason: null,
    };
    try {
      const raw = await this.modelProvider.generate(systemPrompt, userPrompt, {
        temperature: 0.6,
        maxTokens: 200,
        responseFormat: 'json',
      });

      let parsed: Partial<AutoReplyResult>;
      try {
        parsed = JSON.parse(raw) as Partial<AutoReplyResult>;
      } catch {
        this.logger.error(`Модель вернула невалидный JSON: ${raw}`);
        return fallback;
      }

      const reply =
        typeof parsed.reply === 'string'
          ? parsed.reply.trim().replace(/^["']|["']$/g, '') || null
          : null;

      return {
        reply,
        urgent: parsed.urgent === true,
        urgentReason:
          typeof parsed.urgentReason === 'string' ? parsed.urgentReason : null,
      };
    } catch (error) {
      this.logger.error(`Ошибка генерации авто-ответа: ${error}`);
      return fallback;
    }
  }
}
