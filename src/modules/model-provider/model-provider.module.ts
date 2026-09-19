import { Module } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { GroqProvider } from './groq.provider';
import { OllamaProvider } from './ollama.provider';
@Module({
  imports: [HttpModule],
  providers: [
    {
      provide: 'MODEL_PROVIDER',
      useFactory: (config: ConfigService, httpService: HttpService) => {
        const provider = config.get<string>('AI_PROVIDER', 'groq');
        return provider === 'ollama'
          ? new OllamaProvider(httpService, config)
          : new GroqProvider(config);
      },
      inject: [ConfigService, HttpService],
    },
  ],
  exports: ['MODEL_PROVIDER'],
})
export class ModelProviderModule {}
