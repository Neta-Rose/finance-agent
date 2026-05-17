import axios from "axios";
import { getImpersonationToken, clearImpersonationState } from "../store/impersonationStore";

// Lazy import to avoid circular dependency
const getToken = () => {
  try {
    const raw = localStorage.getItem("auth-storage");
    if (!raw) return null;
    return JSON.parse(raw)?.state?.token ?? null;
  } catch {
    return null;
  }
};

export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  // Prefer the impersonation token when an active session exists
  const impersonationToken = getImpersonationToken();
  const token = impersonationToken ?? getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    // Log all API errors with stack trace for debugging
    const status = err.response?.status;
    const url = err.config?.url ?? "(unknown)";
    const method = (err.config?.method ?? "GET").toUpperCase();
    const body = err.response?.data;
    console.error(
      `[API] ${method} ${url} → ${status ?? "network error"}`,
      body ?? err.message,
      err
    );

    // 403 readonly_impersonation — let callers handle it (surface as toast)
    if (
      err.response?.status === 403 &&
      err.response?.data?.error === "readonly_impersonation"
    ) {
      return Promise.reject(err);
    }
    if (err.response?.status === 401) {
      // If we're impersonating, clear the impersonation session and reload
      if (getImpersonationToken()) {
        clearImpersonationState();
        window.location.reload();
        return Promise.reject(err);
      }
      localStorage.removeItem("auth-storage");
      window.location.href = "/login";
    }
    if (
      err.response?.status === 404 &&
      err.response?.data?.error === "user workspace not found"
    ) {
      localStorage.removeItem("auth-storage");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);
