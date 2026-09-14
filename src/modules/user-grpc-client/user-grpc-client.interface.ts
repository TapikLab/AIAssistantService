import { Observable } from 'rxjs';
import type { Metadata } from '@grpc/grpc-js';

export interface GetProfilesRequest {
  userIds: string[];
}

export interface ProfileSummary {
  userId: string;
  username: string;
  avatarUrl: string;
}

export interface GetProfilesResponse {
  profiles: ProfileSummary[];
}

export interface UserInternalService {
  getProfiles(
    data: GetProfilesRequest,
    metadata?: Metadata,
  ): Observable<GetProfilesResponse>;
}
