import { apiClient } from "./client";

export async function login(userId: string, password: string) {
 const res = await apiClient.post<{ token: string; userId: string }>(
 "/auth/login",
 { userId, password }
 );
 return res.data;
}

export async function logout() {
 await apiClient.post("/auth/logout").catch(() => {});
}
