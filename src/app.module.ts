import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from '@common/auth/auth.module';
import { RedisModule } from '@common/redis/redis.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { AssistantModule } from '@modules/assistant/assistant.module';
import { ScheduleModule } from '@modules/schedule/schedule.module';
import { DigestModule } from '@modules/digest/digest.module';
import { AutoReplyModule } from '@modules/auto-reply/auto-reply.module';
import { AutoReplyTriggerModule } from '@modules/auto-reply-trigger/auto-reply-trigger.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    NestScheduleModule.forRoot(),
    ScheduleModule,
    AssistantModule,
    DigestModule,
    AutoReplyModule,
    AutoReplyTriggerModule,
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
    RedisModule,
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
