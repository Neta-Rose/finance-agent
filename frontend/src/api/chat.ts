import { apiClient } from "./client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

export interface SendMessageResponse {
  conversationId: string;
  replyText: string;
  terminationReason: string;
  totalCostUsd: number;
  turnCount: number;
}

export interface ConversationTurn {
  conversationId: string;
  turnIndex: number;
  role: string;
  content: unknown;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  createdAt: string;
}

export interface ConversationHistory {
  conversation: {
    id: string;
    userId: string;
    channel: string;
    startedAt: string;
    endedAt: string | null;
    turnCount: number;
    totalCostUsd: number;
    terminationReason: string | null;
  };
  turns: ConversationTurn[];
}

export async function sendChatMessage(
  text: string,
  conversationId?: string
): Promise<SendMessageResponse> {
  const res = await apiClient.post<SendMessageResponse>("/chat/messages", {
    text,
    conversationId,
  });
  return res.data;
}

export async function getConversationHistory(
  conversationId: string
): Promise<ConversationHistory> {
  const res = await apiClient.get<ConversationHistory>(
    `/chat/conversations/${conversationId}`
  );
  return res.data;
}
