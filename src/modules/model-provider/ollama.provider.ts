import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { BaseModelProvider } from './base-model.provider';
import { GenerateOptions } from './model-provider.interface';

interface OllamaGenerateResponse {
  response: string;
}

@Injectable()
export class OllamaProvider extends BaseModelProvider {
  protected readonly logger = new Logger(OllamaProvider.name);
  protected readonly providerName = 'Ollama';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  protected async doGenerate(
    systemPrompt: string,
    userPrompt: string,
    options: Required<GenerateOptions>,
  ): Promise<string> {
    const url = `${this.configService.getOrThrow<string>('OLLAMA_URL')}/api/generate`;

    const response = await firstValueFrom(
      this.httpService.post<OllamaGenerateResponse>(
        url,
        {
          model: this.configService.getOrThrow<string>('OLLAMA_MODEL'),
          system: systemPrompt,
          prompt: userPrompt,
          stream: false,
          ...(options.responseFormat === 'json' ? { format: 'json' } : {}),
          options: {
            temperature: options.temperature,
            num_predict: options.maxTokens,
          },
        },
        { timeout: options.timeoutMs },
      ),
    );
    return response.data.response;
  }
}
