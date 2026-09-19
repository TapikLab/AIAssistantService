import { Logger, BadRequestException } from '@nestjs/common';
import {
  DEFAULT_GENERATE_OPTIONS,
  GenerateOptions,
  ModelProvider,
} from './model-provider.interface';

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

// Коды/сообщения, характерные для сетевых сбоев (пропал интернет, обрыв связи с
// провайдером модели, таймаут) или временной перегрузки — их имеет смысл повторить.
// Ошибки самой модели (невалидный промпт, авторизация и т.п.) не ретраим.
const RETRYABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNABORTED',
]);
const RETRYABLE_MESSAGE_PATTERN =
  /timeout|timed out|network|socket hang up|econn|fetch failed/i;

export abstract class BaseModelProvider implements ModelProvider {
  protected abstract readonly logger: Logger;
  protected abstract readonly providerName: string;

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options?: GenerateOptions,
  ): Promise<string> {
    const resolved: Required<GenerateOptions> = {
      ...DEFAULT_GENERATE_OPTIONS,
      ...options,
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.doGenerate(systemPrompt, userPrompt, resolved);
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryable(error);
        this.logger.warn(
          `${this.providerName} попытка ${attempt}/${MAX_ATTEMPTS} неудачна` +
            `${retryable ? ', повтор' : ', ошибка не сетевая, повтор не имеет смысла'}: ${error}`,
        );
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await this.delay(RETRY_BASE_DELAY_MS * attempt);
      }
    }

    this.logger.error(
      `${this.providerName} request failed after retries: ${lastError}`,
    );
    throw new BadRequestException('Сервис подсказок временно недоступен');
  }

  private isRetryable(error: unknown): boolean {
    const code = (error as { code?: string } | undefined)?.code;
    const status =
      (error as { status?: number } | undefined)?.status ??
      (error as { response?: { status?: number } } | undefined)?.response
        ?.status;
    const message = error instanceof Error ? error.message : String(error);

    if (code && RETRYABLE_CODES.has(code)) return true;
    if (typeof status === 'number' && (status === 429 || status >= 500)) {
      return true;
    }
    return RETRYABLE_MESSAGE_PATTERN.test(message);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected abstract doGenerate(
    systemPrompt: string,
    userPrompt: string,
    options: Required<GenerateOptions>,
  ): Promise<string>;
}
