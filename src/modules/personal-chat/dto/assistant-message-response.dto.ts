export type AssistantActionType =
  'AUTO_REPLY_UPDATED' | 'CLARIFICATION_NEEDED' | 'NONE';

export interface AssistantAction {
  type: AssistantActionType;
  targetChatId?: string;
  enabled?: boolean;
}

export interface AssistantMessageResponse {
  messageId: string;
  reply: string;
  action: AssistantAction;
}
