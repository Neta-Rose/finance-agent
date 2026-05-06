import { apiClient } from "./client";

export interface BindingCodeResponse {
  code: string;
  expiresAt: string;
  instructions: {
    telegram: string;
    whatsapp: string;
  };
}

export async function getChannelBindingCode(): Promise<BindingCodeResponse> {
  const res = await apiClient.post<BindingCodeResponse>("/channels/binding-codes");
  return res.data;
}
