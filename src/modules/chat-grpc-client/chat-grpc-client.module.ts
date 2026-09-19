import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { ChatGrpcClientService } from './chat-grpc-client.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'CHAT_GRPC_PACKAGE',
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'chat',
            protoPath: join(process.cwd(), 'dist/proto/chat.proto'),
            url: config.getOrThrow<string>('CHAT_SERVICE_GRPC_URL'),
            loader: { defaults: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [ChatGrpcClientService],
  exports: [ChatGrpcClientService],
})
export class ChatGrpcClientModule {}
