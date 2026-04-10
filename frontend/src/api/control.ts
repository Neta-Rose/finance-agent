// frontend/src/api/control.ts
import { apiClient } from "./client";

export interface Banner {
  text:        string;
  type:        "info" | "warning" | "error";
  dismissible: boolean;
  expiresAt:   string | null;
}

export interface ControlState {
  restriction:      "readonly" | "blocked" | "suspended" | null;
  reason:           string;
  restrictedUntil:  string | null;
  banner:           Banner | null;
  systemLocked:     boolean;
  systemLockReason: string;
  systemBroadcast:  Banner | null;
}

export const fetchControlState = async (): Promise<ControlState> => {
  const res = await apiClient.get<ControlState>("/me/control");
  return res.data;
};
