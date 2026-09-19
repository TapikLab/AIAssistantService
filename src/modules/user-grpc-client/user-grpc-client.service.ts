import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  UserInternalService,
  ProfileSummary,
} from './user-grpc-client.interface';
import { buildInternalGrpcMetadata } from './internal-grpc-metadata';

@Injectable()
export class UserGrpcClientService implements OnModuleInit {
  private userInternalService!: UserInternalService;

  constructor(
    @Inject('USER_GRPC_PACKAGE') private readonly client: ClientGrpc,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.userInternalService =
      this.client.getService<UserInternalService>('UserInternal');
  }

  async getProfiles(userIds: string[]): Promise<ProfileSummary[]> {
    if (userIds.length === 0) return [];

    const response = await firstValueFrom(
      this.userInternalService.getProfiles({ userIds }, this.metadata()),
    );
    return response.profiles ?? [];
  }

  private metadata() {
    return buildInternalGrpcMetadata(
      this.config.getOrThrow<string>('INTERNAL_API_KEY'),
    );
  }
}
