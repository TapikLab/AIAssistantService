import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { BaseModelProvider } from './base-model.provider';
import { GenerateOptions } from './model-provider.interface';

@Injectable()
export class GroqProvider extends BaseModelProvider {
  protected readonly logger = new Logger(GroqProvider.name);
  protected readonly providerName = 'Groq';
  private readonly client: Groq;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.client = new Groq({
      apiKey: this.configService.getOrThrow<string>('GROQ_API_KEY'),
    });
    this.model = this.configService.get<string>(
      'GROQ_MODEL',
      'qwen/qwen3.8-27b',
    );
  }

  protected async doGenerate(
    systemPrompt: string,
    userPrompt: string,
    options: Required<GenerateOptions>,
  ): Promise<string> {
    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        ...(options.responseFormat === 'json'
          ? { response_format: { type: 'json_object' as const } }
          : {}),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      },
      { timeout: options.timeoutMs },
    );

    return completion.choices[0]?.message?.content ?? '';
  }
}
