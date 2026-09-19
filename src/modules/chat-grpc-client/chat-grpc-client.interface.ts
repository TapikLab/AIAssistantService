import { Observable } from 'rxjs';
import type { Metadata } from '@grpc/grpc-js';

export interface SendMessageInternalRequest {
  chatId: string;
  senderId: string;
  content: string;
  viaAssistant?: boolean;
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

export interface UserMessagesInChatRequest {
  chatId: string;
  userId: string;
  limit: number;
}

export interface UserMessagesInChatResponse {
  messages: string[];
}

export interface RecentMessagesRequest {
  chatId: string;
  limit: number;
}

export interface RecentMessage {
  senderId: string;
  content: string;
  viaAssistant: boolean;
  createdAt: string;
}

export interface RecentMessagesResponse {
  messages: RecentMessage[];
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
  getUserMessagesInChat(
    data: UserMessagesInChatRequest,
    metadata?: Metadata,
  ): Observable<UserMessagesInChatResponse>;
  getRecentMessages(
    data: RecentMessagesRequest,
    metadata?: Metadata,
  ): Observable<RecentMessagesResponse>;
}
