import { Module } from '@nestjs/common';
import { PersonalChatController } from './personal-chat.controller';
import { PersonalChatService } from './personal-chat.service';
import { IntentParserService } from './intent-parser.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ChatGrpcClientModule } from '@modules/chat-grpc-client/chat-grpc-client.module';
import { UserGrpcClientModule } from '@modules/user-grpc-client/user-grpc-client.module';
import { AutoReplyModule } from '@modules/auto-reply/auto-reply.module';
import { ModelProviderModule } from '@modules/model-provider/model-provider.module';

@Module({
  imports: [
    PrismaModule,
    ChatGrpcClientModule,
    UserGrpcClientModule,
    AutoReplyModule,
    ModelProviderModule,
  ],
  controllers: [PersonalChatController],
  providers: [PersonalChatService, IntentParserService],
})
export class PersonalChatModule {}
