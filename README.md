# AIAssistantService

ИИ-ассистент платформы **Tapik** — генерирует подсказки для ответа в чате на основе LLM (Groq или локальная Ollama) и умеет ставить сообщения на отложенную отправку. Часть микросервисной архитектуры Tapik.

## Роль в системе

```
                     ┌──────────────────┐
   HTTP (JWT) ──────▶│ AIAssistantService│
                     └─────────┬─────────┘
                               │ gRPC (x-internal-key)
                               ▼
                        ┌─────────────┐
                        │ ChatService │
                        └─────────────┘
```

- Принимает HTTP-запросы от авторизованных пользователей (через `JwtAuthGuard`, тот же `JWT_SECRET`, что у AuthService).
- Обращается к внешним LLM-провайдерам (Groq API или self-hosted Ollama) для генерации текста.
- Периодически (каждые 30 секунд) проверяет БД на отложенные сообщения и отправляет их в ChatService по внутреннему gRPC, защищённому shared-secret заголовком `x-internal-key`.

## Технологии

- **NestJS 11** (TypeScript), гибридное приложение (HTTP + `@nestjs/schedule` cron)
- **PostgreSQL** через **Prisma 7** (`@prisma/adapter-pg`)
- **Redis** (ioredis) — кэш контекста собеседника
- **gRPC** (`@grpc/grpc-js`) — клиент к ChatService (`ChatInternal`)
- **Groq SDK** и raw HTTP (`@nestjs/axios`) — LLM-провайдеры
- **class-validator / class-transformer** — валидация DTO
- Path-алиасы: `@common/*`, `@modules/*`, `@proto/*`

## Возможности

- `POST /assistant/suggest-replies` — по истории переписки возвращает 3 варианта ответа на языке последнего сообщения (поддержка русского, английского, армянского в двух алфавитах), с учётом тона (`casual` / `formal` / `friendly`).
- Отложенная отправка сообщений: пользователь планирует сообщение на будущее время, фоновый раннер сам отправляет его в нужный момент через ChatService.
- Абстракция над LLM-провайдерами (`ModelProvider`) — переключение Groq ↔ Ollama одной переменной окружения, без изменения кода вызывающей стороны.

## API

Все эндпоинты защищены `JwtAuthGuard`, кроме `GET /` (исключение | `GET /assistant/digest`).

| Метод    | Путь                         | Rate limit | Описание                                                          |
| -------- | ---------------------------- | ---------- | ----------------------------------------------------------------- |
| `POST`   | `/assistant/suggest-replies` | 10/мин     | Сгенерировать 3 варианта ответа по истории сообщений              |
| `POST`   | `/assistant/schedule`        | —          | Запланировать отложенную отправку сообщения в чат                 |
| `GET`    | `/assistant/schedule`        | —          | Список ожидающих отправки сообщений текущего пользователя         |
| `GET`    | `/assistant/digest`          | 10/мин     | Дайджест непрочитанных сообщений по всем чатам (кэш 120с в Redis) |
| `DELETE` | `/assistant/schedule/:id`    | —          | Отменить запланированное сообщение                                |

### `POST /assistant/suggest-replies`

```json
{
  "messages": [{ "role": "other", "content": "Привет! Как дела?" }],
  "tone": "casual",
  "chatId": "uuid",
  "participantName": "Аня"
}
```

→ `["Привет! Отлично, а у тебя?", "Привет! Занят немного, но норм", "Привет, всё хорошо!"]`

### `POST /assistant/schedule`

```json
{ "chatId": "uuid", "content": "Напоминание", "sendAt": "2026-09-08T10:00:00Z" }
```

## gRPC: клиент к ChatService

Использует `chat.proto` (`ChatInternal`): `SendMessageInternal`, `IsMember`. Каждый вызов несёт метаданные `x-internal-key: <INTERNAL_API_KEY>` — ChatService отклонит запрос без корректного ключа (`InternalGrpcAuthGuard` на стороне ChatService).

Планировщик (`ScheduleRunnerService`, `@Cron(EVERY_30_SECONDS)`):

1. Берёт из БД до 50 сообщений со статусом `pending` и `sendAt <= now()`.
2. Захватывает Redis-блокировку (`SET NX PX 25000`) — при горизонтальном масштабировании только один инстанс обрабатывает тик, сообщения не дублируются.
3. Для каждого сообщения повторно проверяет членство отправителя в чате (`IsMember`) — если пользователя успели удалить из чата, сообщение помечается `failed`, а не отправляется.
4. Отправляет через `SendMessageInternal`, обновляет статус (`sent` / `failed`). Ошибка одного сообщения не прерывает обработку остальных в батче.

## Переменные окружения

| Переменная                  | Обязательна                   | Назначение                                                                                               |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PORT`                      | нет (3007)                    | HTTP-порт                                                                                                |
| `JWT_SECRET`                | да                            | Секрет для проверки access-токенов (общий с AuthService)                                                 |
| `AI_PROVIDER`               | нет (`groq`)                  | `groq` или `ollama`                                                                                      |
| `GROQ_API_KEY`              | да, если `AI_PROVIDER=groq`   | Ключ Groq API                                                                                            |
| `GROQ_MODEL`                | нет                           | Модель Groq (по умолчанию `qwen/qwen3.8-27b`)                                                            |
| `OLLAMA_URL`                | да, если `AI_PROVIDER=ollama` | URL self-hosted Ollama                                                                                   |
| `OLLAMA_MODEL`              | да, если `AI_PROVIDER=ollama` | Имя модели в Ollama                                                                                      |
| `REDIS_HOST` / `REDIS_PORT` | нет                           | Redis для кэша контекста                                                                                 |
| `DATABASE_URL`              | да                            | Строка подключения PostgreSQL                                                                            |
| `CHAT_SERVICE_GRPC_URL`     | да                            | Адрес gRPC-сервера ChatService                                                                           |
| `INTERNAL_API_KEY`          | да                            | Shared-secret для внутренних gRPC-вызовов (тот же ключ, что у ChatService/MediaService/ReactionsService) |
| `USER_SERVICE_GRPC_URL`     | да                            | Адрес gRPC-сервера UserService (`UserInternal.GetProfiles`)                                              |

## Структура проекта

```
src/
├── main.ts
├── app.module.ts
├── common/
│   ├── auth/         # JwtStrategy, JwtAuthGuard, AuthenticatedRequest
│   ├── prisma/        # PrismaService
│   └── redis/          # RedisService
├── modules/
│   ├── assistant/      # suggest-replies: контроллер, сервис, DTO
│   ├── model-provider/ # ModelProvider интерфейс, BaseModelProvider, Groq/Ollama
│   ├── schedule/        # отложенные сообщения: controller, service, runner
│   └── chat-grpc-client/ # gRPC-клиент к ChatService + internal-key metadata
└── proto/
    └── chat.proto
```

## Запуск

```bash
npm install
npx prisma generate
npx prisma migrate deploy

npm run start:dev     # разработка (watch)
npm run build && npm run start:prod
npm run test           # unit-тесты (jest)
npm run lint
```

## Безопасность

- Все пользовательские эндпоинты требуют валидный JWT (`Authorization: Bearer`).
- Глобальный `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — лишние/некорректные поля отклоняются.
- Длина контента в истории сообщений ограничена (`@MaxLength(4000)`) для защиты от prompt injection и чрезмерных затрат на LLM.
- Таймаут (`timeoutMs`) на каждый вызов LLM-провайдера — зависший провайдер не блокирует запрос навсегда.
- Исходящие gRPC-вызовы к ChatService подписаны shared-secret заголовком, не полагаются только на сетевую изоляцию.
