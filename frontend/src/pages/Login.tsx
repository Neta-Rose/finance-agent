import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { login } from "../api/auth";

export function Login() {
 const navigate = useNavigate();
 const loginStore = useAuthStore((s) => s.login);
 const [userId, setUserId] = useState("");
 const [password, setPassword] = useState("");
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");

 const handleSubmit = async (e?: FormEvent) => {
 e?.preventDefault();
 if (!userId.trim() || !password.trim()) return;
 setLoading(true);
 setError("");
 try {
 const data = await login(userId.trim(), password);
 loginStore(data.token, data.userId);
 navigate("/", { replace: true });
 } catch {
 setError("Invalid credentials. Please try again.");
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)] px-4">
 <div className="w-full max-w-sm">
 <div className="text-center mb-8">
 <div className="text-5xl mb-2">📊</div>
 <h1 className="text-xl font-bold text-[var(--color-fg-default)]">Portfolio Command Center</h1>
 <p className="text-sm text-[var(--color-fg-muted)] mt-1">Sign in to your account</p>
 </div>

 <form onSubmit={handleSubmit} className="space-y-3">
 <input
 type="text"
 placeholder="User ID"
 value={userId}
 onChange={(e) => setUserId(e.target.value)}
 className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
 autoComplete="username"
 />
 <input
 type="password"
 placeholder="Password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
 className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
 autoComplete="current-password"
 />
 {error && <p className="text-[var(--color-accent-red)] text-sm text-center">{error}</p>}
 <button
 type="submit"
 disabled={loading}
 className="w-full bg-[var(--color-accent-blue)] text-white rounded-lg py-3 font-semibold text-sm disabled:opacity-50"
 >
 {loading ? "Signing in..." : "Sign In"}
 </button>
 </form>
 </div>
 </div>
 );
}
