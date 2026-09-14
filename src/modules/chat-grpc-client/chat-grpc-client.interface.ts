import { Observable } from 'rxjs';
import type { Metadata } from '@grpc/grpc-js';

export interface SendMessageInternalRequest {
  chatId: string;
  senderId: string;
  content: string;
}

export interface SendMessageInternalResponse {
  success: boolean;
  messageId: string;
  error: string;
}

export interface MembershipRequest {
  chatId: string;
  userId: string;
}

export interface MembershipResponse {
  isMember: boolean;
}

export interface UnreadMessagesRequest {
  userId: string;
  maxMessagesPerChat: number;
}

export interface UnreadMessage {
  messageId: string;
  senderId: string;
  content: string;
  type: string;
  createdAt: string;
}

export interface UnreadChat {
  chatId: string;
  chatType: string;
  title: string;
  otherMemberId: string;
  messages: UnreadMessage[];
}

export interface UnreadMessagesResponse {
  chats: UnreadChat[];
}

export interface ChatInternalService {
  sendMessageInternal(
    data: SendMessageInternalRequest,
    metadata?: Metadata,
  ): Observable<SendMessageInternalResponse>;
  isMember(
    data: MembershipRequest,
    metadata?: Metadata,
  ): Observable<MembershipResponse>;
  getUnreadMessages(
    data: UnreadMessagesRequest,
    metadata?: Metadata,
  ): Observable<UnreadMessagesResponse>;
}
