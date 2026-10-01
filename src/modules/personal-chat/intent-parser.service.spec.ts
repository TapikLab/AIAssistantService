import { Test, TestingModule } from '@nestjs/testing';
import {
  AssistantIntentType,
  IntentParserService,
} from './intent-parser.service';

describe('IntentParserService', () => {
  let service: IntentParserService;
  let generate: jest.Mock;

  beforeEach(async () => {
    generate = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentParserService,
        { provide: 'MODEL_PROVIDER', useValue: { generate } },
      ],
    }).compile();

    service = module.get<IntentParserService>(IntentParserService);
  });

  it('разбирает явную команду в SET_AUTO_REPLY с именем и enabled', async () => {
    generate.mockResolvedValue(
      JSON.stringify({
        type: 'SET_AUTO_REPLY',
        participantNameQuery: 'Ани',
        enabled: true,
        customInstructions: 'скажи, что я занят',
        confidence: 0.95,
      }),
    );

    const result = await service.parse('Включи авто-ответ для Ани');

    expect(result).toEqual({
      type: AssistantIntentType.SET_AUTO_REPLY,
      participantNameQuery: 'Ани',
      enabled: true,
      customInstructions: 'скажи, что я занят',
      confidence: 0.95,
    });
  });

  it('возвращает UNKNOWN, если модель не назвала имя собеседника', async () => {
    generate.mockResolvedValue(
      JSON.stringify({
        type: 'SET_AUTO_REPLY',
        participantNameQuery: null,
        confidence: 0.9,
      }),
    );

    const result = await service.parse('включи авто-ответ');

    expect(result.type).toBe(AssistantIntentType.UNKNOWN);
  });

  it('возвращает UNKNOWN при невалидном JSON от модели, не бросает исключение', async () => {
    generate.mockResolvedValue('это не json');

    const result = await service.parse('что угодно');

    expect(result).toEqual({
      type: AssistantIntentType.UNKNOWN,
      confidence: 0,
    });
  });

  it('возвращает UNKNOWN, если MODEL_PROVIDER падает по таймауту', async () => {
    generate.mockRejectedValue(new Error('timeout'));

    const result = await service.parse('включи авто-ответ для Ани');

    expect(result).toEqual({
      type: AssistantIntentType.UNKNOWN,
      confidence: 0,
    });
  });

  it('снимает markdown-обёртку ```json``` перед парсингом', async () => {
    generate.mockResolvedValue(
      '```json\n' +
        JSON.stringify({
          type: 'SET_AUTO_REPLY',
          participantNameQuery: 'Артём',
          enabled: false,
          confidence: 0.8,
        }) +
        '\n```',
    );

    const result = await service.parse('выключи авто-ответ для Артёма');

    expect(result.type).toBe(AssistantIntentType.SET_AUTO_REPLY);
    if (result.type === AssistantIntentType.SET_AUTO_REPLY) {
      expect(result.participantNameQuery).toBe('Артём');
      expect(result.enabled).toBe(false);
    }
  });
});
