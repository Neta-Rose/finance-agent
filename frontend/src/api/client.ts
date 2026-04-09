import axios from "axios";

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
 const token = getToken();
 if (token) config.headers.Authorization = `Bearer ${token}`;
 return config;
});

apiClient.interceptors.response.use(
 (res) => res,
 (err) => {
 if (err.response?.status === 401) {
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
