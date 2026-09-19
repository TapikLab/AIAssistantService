import { Module } from '@nestjs/common';
import { AutoReplyController } from './auto-reply.controller';
import { AutoReplySettingService } from './auto-reply-setting.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ChatGrpcClientModule } from '@modules/chat-grpc-client/chat-grpc-client.module';

@Module({
  imports: [PrismaModule, ChatGrpcClientModule],
  controllers: [AutoReplyController],
  providers: [AutoReplySettingService],
  exports: [AutoReplySettingService],
})
export class AutoReplyModule {}
