import { apiClient } from "./client";
import type { SearchResponse } from "../types/api";

export const searchTicker = async (q: string): Promise<SearchResponse> =>
  (await apiClient.get<SearchResponse>(`/search/ticker?q=${encodeURIComponent(q)}`)).data;
