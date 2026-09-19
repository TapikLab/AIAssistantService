import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { SuggestReplyDto } from './dto/suggest-reply.dto';
import { RedisService } from '@common/redis/redis.service';
import type { ModelProvider } from '@modules/model-provider/model-provider.interface';

interface AssistantContext {
  participantName?: string;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly redisService: RedisService,
    @Inject('MODEL_PROVIDER') private readonly modelProvider: ModelProvider,
  ) {}

  async suggestReplies(
    dto: SuggestReplyDto,
    userId?: string,
  ): Promise<string[]> {
    const context = await this.resolveContext(dto, userId);
    const { systemPrompt, userPrompt } = this.buildPrompt(dto, context);

    const rawResponse = await this.modelProvider.generate(
      systemPrompt,
      userPrompt,
      { responseFormat: 'json' },
    );
    return this.parseSuggestions(rawResponse);
  }

  private buildPrompt(
    dto: SuggestReplyDto,
    context: AssistantContext,
  ): { systemPrompt: string; userPrompt: string } {
    const toneInstructions: Partial<Record<string, string>> = {
      casual: 'в неформальном, дружелюбном стиле',
      formal: 'в официальном, вежливом стиле',
    };
    const toneInstruction =
      toneInstructions[dto.tone ?? 'casual'] ?? 'в обыденном стиле';

    const participantName = context.participantName ?? 'Собеседник';
    const lastMessage = dto.messages[dto.messages.length - 1];
    const isLastFromMe = lastMessage?.role === 'me';

    const systemPrompt = `You are a chat reply assistant. Respond ONLY in valid JSON format.

                    РОЛЬ И ТОЧКА ЗРЕНИЯ:
                    Ты помогаешь пользователю "Я" (me) вести диалог с собеседником ("${participantName}").
                    ${
                      isLastFromMe
                        ? `ВНИМАНИЕ: Последнее сообщение в чате отправил "Я". Модель должна предложить 3 варианта ПРОДОЛЖЕНИЯ/УТОЧНЕНИЯ мысли от лица "Я" (например: повторное напоминание, мягкий фоллоу-ап или ввод новой темы). НЕ отвечай на вопрос "Я" от лица собеседника!`
                        : `Все 3 варианта ответа должны быть написаны от первого лица ("Я") как ПРЯМОЙ ОТВЕТ на последнее сообщение собеседника.`
                    }

                    ГЛАВНОЕ ПРАВИЛО ЯЗЫКА:
                    Определи язык и алфавит ПОСЛЕДНЕГО сообщения и отвечай СТРОГО на том же языке и в той же письменности:
                    - Русский → отвечай на русском.
                    - Английский → отвечай на английском.
                    - Армянский (армянскими буквами) → отвечай армянскими буквами.
                    - Армянский ЛАТИНСКИМИ буквами (транслитерация: "barev", "vonc es") → отвечай ТОЖЕ армянским ЛАТИНСКИМИ буквами.

                    ЗАДАЧА:
                    Предложи ровно 3 коротких, естественных варианта реплики для "Я", ${toneInstruction}.

                    ФОРМАТ ОТВЕТА (JSON):
                    Выведи исключительно JSON-объект:
                    {
                      "replies": ["вариант 1", "вариант 2", "вариант 3"]
                    }`;

    const userPrompt =
      dto.messages
        .map(
          (m, index) =>
            `[Сообщение ${index + 1}] ${m.role === 'me' ? 'Я' : participantName}: ${m.content}`,
        )
        .join('\n') + `\n\n(Сгенерируй 3 варианта следующей реплики для "Я")`;

    return { systemPrompt, userPrompt };
  }

  private async resolveContext(
    dto: SuggestReplyDto,
    userId?: string,
  ): Promise<AssistantContext> {
    if (!dto.chatId) {
      return { participantName: dto.participantName };
    }

    const cacheKey = `assistant_context:${dto.chatId}${userId ? `:${userId}` : ''}`;

    if (dto.participantName) {
      await this.redisService.client.set(
        cacheKey,
        JSON.stringify({ participantName: dto.participantName }),
        'EX',
        3600,
      );
      return { participantName: dto.participantName };
    }
    const cached = await this.redisService.client.get(cacheKey);
    return cached ? (JSON.parse(cached) as AssistantContext) : {};
  }

  private parseSuggestions(raw: string): string[] {
    const cleanedRaw = raw.replace(/```json\n?|```/g, '').trim();

    try {
      const parsed: unknown = JSON.parse(cleanedRaw);
      const extracted = this.extractArrayFromJson(parsed);
      if (extracted) return extracted;
    } catch (error) {
      this.logger.debug(`Ответ модели не является валидным JSON: ${error}`);
    }

    const arrayMatch = cleanedRaw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed: unknown = JSON.parse(arrayMatch[0]);
        const extracted = this.extractArrayFromJson(parsed);
        if (extracted) return extracted;
      } catch (error) {
        this.logger.debug(`Не удалось разобрать JSON-фрагмент: ${error}`);
      }
    }

    const lines = cleanedRaw
      .split('\n')
      .map((line) =>
        line
          .replace(/^[\d.\-*)\s"]+/, '')
          .replace(/["\s]+$/, '')
          .trim(),
      )
      .filter(
        (line) =>
          line.length > 2 &&
          line.length < 200 &&
          !line.includes('{') &&
          !line.includes('['),
      );

    if (lines.length >= 2) {
      this.logger.warn('Использован построчный разбор ответа как fallback');
      return lines.slice(0, 3);
    }

    this.logger.error(`Не удалось разобрать ответ модели: ${raw}`);
    throw new BadRequestException(
      'Не удалось сгенерировать подсказки, попробуйте ещё раз',
    );
  }

  private extractArrayFromJson(parsed: unknown): string[] | null {
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed.slice(0, 3);
    }

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.replies)) {
        const replies = record.replies
          .filter((item): item is string => typeof item === 'string')
          .map((s) => s.trim())
          .filter(Boolean);
        if (replies.length >= 1) return replies.slice(0, 3);
      }

      const arrayValue = Object.values(record).find(
        (v) => Array.isArray(v) && v.every((item) => typeof item === 'string'),
      );
      if (arrayValue) {
        return arrayValue.map((s) => s.trim()).slice(0, 3);
      }
    }

    const collected = [...new Set(this.collectStrings(parsed))];
    return collected.length >= 2 ? collected.slice(0, 3) : null;
  }

  private collectStrings(value: unknown, acc: string[] = []): string[] {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 2 && trimmed.length < 300) {
        acc.push(trimmed);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        this.collectStrings(item, acc);
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const val of Object.values(value)) {
        this.collectStrings(val, acc);
      }
    }
    return acc;
  }
}
