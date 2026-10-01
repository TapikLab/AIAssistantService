import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ModelProvider } from '@modules/model-provider/model-provider.interface';

export enum AssistantIntentType {
  SET_AUTO_REPLY = 'SET_AUTO_REPLY',
  UNKNOWN = 'UNKNOWN',
}

export interface UnknownIntent {
  type: AssistantIntentType.UNKNOWN;
  confidence: number;
}

export interface SetAutoReplyIntent {
  type: AssistantIntentType.SET_AUTO_REPLY;
  participantNameQuery: string;
  enabled?: boolean;
  customInstructions?: string;
  confidence: number;
}

export type ParsedIntent = UnknownIntent | SetAutoReplyIntent;

// Ниже этого порога считаем распознавание ненадёжным: конфигурацию не трогаем,
// у пользователя запрашиваем уточнение (Requirement 4 — graceful degradation).
export const INTENT_CONFIDENCE_THRESHOLD = 0.6;

const UNKNOWN_INTENT: ParsedIntent = {
  type: AssistantIntentType.UNKNOWN,
  confidence: 0,
};

const SYSTEM_PROMPT = `Ты — модуль распознавания намерений в личном чате пользователя с ИИ-ассистентом мессенджера.
Пользователь пишет тебе команды на естественном языке про управление авто-ответом в своих ЛИЧНЫХ (1-на-1) чатах.

Разбери ПОСЛЕДНЕЕ сообщение пользователя и верни СТРОГО JSON без пояснений:
{
  "type": "SET_AUTO_REPLY" | "UNKNOWN",
  "participantNameQuery": "имя собеседника, как оно написано у пользователя, или null",
  "enabled": true | false | null,
  "customInstructions": "инструкция для авто-ответа своими словами, если пользователь её дал, иначе null",
  "confidence": число от 0 до 1
}

Правила:
- "type": "SET_AUTO_REPLY" — если сообщение просит включить/выключить/настроить авто-ответ для конкретного собеседника.
- "participantNameQuery" ОБЯЗАТЕЛЕН для SET_AUTO_REPLY — это имя человека, как оно упомянуто (например "Ани", "Артём"), не chatId.
- "enabled" — true если просят включить, false если выключить. Если явно не сказано — null.
- "customInstructions" — если пользователь описал, ЧТО отвечать ("скажи, что я занят"), перескажи это как инструкцию для авто-ответчика от третьего лица, коротко. Если не описал — null.
- Если сообщение не про авто-ответ, или намерение непонятно, или не указано имя собеседника — верни "type": "UNKNOWN", остальные поля null, confidence <= 0.3.
- "confidence" — насколько ты уверен в разборе: 1.0 однозначная команда с именем и явным enabled; 0.5-0.7 команда похожа, но что-то не хватает (например неясно, включить или выключить); ниже 0.5 — гадание.
- Никогда не выдумывай имя собеседника, если оно не упомянуто в сообщении.`;

@Injectable()
export class IntentParserService {
  private readonly logger = new Logger(IntentParserService.name);

  constructor(
    @Inject('MODEL_PROVIDER') private readonly modelProvider: ModelProvider,
  ) {}

  async parse(message: string): Promise<ParsedIntent> {
    let raw: string;
    try {
      raw = await this.modelProvider.generate(SYSTEM_PROMPT, message, {
        responseFormat: 'json',
        timeoutMs: 10000,
        maxTokens: 300,
      });
    } catch (error) {
      this.logger.error(`Модель недоступна при разборе намерения: ${error}`);
      return UNKNOWN_INTENT;
    }

    return this.safeParse(raw);
  }

  private safeParse(raw: string): ParsedIntent {
    const cleaned = raw.replace(/```json\s*|```/g, '').trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      this.logger.warn(`Ответ модели не является валидным JSON: ${error}`);
      return UNKNOWN_INTENT;
    }

    if (typeof parsed !== 'object' || parsed === null) return UNKNOWN_INTENT;
    const record = parsed as Record<string, unknown>;

    const confidence =
      typeof record.confidence === 'number' &&
      record.confidence >= 0 &&
      record.confidence <= 1
        ? record.confidence
        : 0;

    if (record.type !== AssistantIntentType.SET_AUTO_REPLY) {
      return { type: AssistantIntentType.UNKNOWN, confidence };
    }

    const participantNameQuery =
      typeof record.participantNameQuery === 'string' &&
      record.participantNameQuery.trim()
        ? record.participantNameQuery.trim()
        : undefined;

    // Без имени собеседника SET_AUTO_REPLY не выполним — это невалидный intent.
    if (!participantNameQuery) return UNKNOWN_INTENT;

    return {
      type: AssistantIntentType.SET_AUTO_REPLY,
      participantNameQuery,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
      customInstructions:
        typeof record.customInstructions === 'string' &&
        record.customInstructions.trim()
          ? record.customInstructions.trim()
          : undefined,
      confidence,
    };
  }
}
