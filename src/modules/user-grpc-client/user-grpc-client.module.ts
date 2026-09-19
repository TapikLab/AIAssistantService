import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { UserGrpcClientService } from './user-grpc-client.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'USER_GRPC_PACKAGE',
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'user',
            protoPath: join(process.cwd(), 'dist/proto/user.proto'),
            url: config.getOrThrow<string>('USER_SERVICE_GRPC_URL'),
            loader: { defaults: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [UserGrpcClientService],
  exports: [UserGrpcClientService],
})
export class UserGrpcClientModule {}
