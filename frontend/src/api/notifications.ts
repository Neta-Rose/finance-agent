import { apiClient } from "./client";

export interface NotificationItem {
  id: string;
  userId: string;
  category: "daily_brief" | "report" | "market_news";
  title: string;
  body: string;
  ticker: string | null;
  batchId: string | null;
  channel: "telegram" | "web" | "whatsapp";
  createdAt: string;
  delivered: boolean;
  deliveredAt: string | null;
  readAt: string | null;
  error: string | null;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export async function fetchNotifications(params?: {
  limit?: number;
  channel?: "web" | "telegram" | "whatsapp";
  unread?: boolean;
}): Promise<NotificationsResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.channel) query.set("channel", params.channel);
  if (params?.unread) query.set("unread", "true");
  const suffix = query.toString();
  return (await apiClient.get<NotificationsResponse>(`/notifications${suffix ? `?${suffix}` : ""}`)).data;
}

export async function markNotificationsRead(ids: string[]): Promise<{ updated: number }> {
  return (await apiClient.post<{ updated: number }>("/notifications/read", { ids })).data;
}
