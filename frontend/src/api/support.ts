import { apiClient } from "./client";
import type { SupportMessageCreate, SupportMessageRecord } from "../types/api";

export async function submitSupportMessage(payload: SupportMessageCreate): Promise<SupportMessageRecord> {
  const response = await apiClient.post<{ message: SupportMessageRecord }>("/support/messages", payload);
  return response.data.message;
}
