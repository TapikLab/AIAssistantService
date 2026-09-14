import { Module } from '@nestjs/common';
import { DigestController } from './digest.controller';
import { DigestService } from './digest.service';
import { RedisModule } from '@common/redis/redis.module';
import { ModelProviderModule } from '@modules/model-provider/model-provider.module';
import { ChatGrpcClientModule } from '@modules/chat-grpc-client/chat-grpc-client.module';
import { UserGrpcClientModule } from '@modules/user-grpc-client/user-grpc-client.module';

@Module({
  imports: [
    RedisModule,
    ModelProviderModule,
    ChatGrpcClientModule,
    UserGrpcClientModule,
  ],
  controllers: [DigestController],
  providers: [DigestService],
})
export class DigestModule {}
