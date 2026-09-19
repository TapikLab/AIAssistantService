import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AutoReplyTriggerController } from './auto-reply-trigger.controller';
import { AutoReplyGeneratorService } from './auto-reply-generator.service';
import { RedisModule } from '@common/redis/redis.module';
import { ChatGrpcClientModule } from '@modules/chat-grpc-client/chat-grpc-client.module';
import { UserGrpcClientModule } from '@modules/user-grpc-client/user-grpc-client.module';
import { ModelProviderModule } from '@modules/model-provider/model-provider.module';
import { AutoReplyModule } from '@modules/auto-reply/auto-reply.module';

@Module({
  imports: [
    RedisModule,
    ChatGrpcClientModule,
    UserGrpcClientModule,
    ModelProviderModule,
    AutoReplyModule,
    ClientsModule.registerAsync([
      {
        name: 'NOTIFICATION_SERVICE',
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: 'notification_events',
            queueOptions: { durable: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [AutoReplyTriggerController],
  providers: [AutoReplyGeneratorService],
})
export class AutoReplyTriggerModule {}
