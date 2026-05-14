import { useEffect, useState } from "react";
import { LogOut, Eye } from "lucide-react";
import {
  getImpersonationState,
  clearImpersonationState,
} from "../store/impersonationStore";
import { adminRevokeImpersonationSession } from "../api/admin";

/**
 * ImpersonationBanner — S07 (Pilot Operational Visibility)
 *
 * Renders a sticky red banner at the top of the page when an active
 * read-only impersonation session exists. Shows the target user ID,
 * a live countdown, and an "Exit" button that revokes the session.
 *
 * Mounted globally in App.tsx.
 */

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ImpersonationBanner() {
  const [state, setState] = useState(() => getImpersonationState());
  const [countdown, setCountdown] = useState<string>("");
  const [exiting, setExiting] = useState(false);

  // Refresh state from sessionStorage every second and update countdown
  useEffect(() => {
    const tick = () => {
      const current = getImpersonationState();
      setState(current);
      if (current) {
        const ms = new Date(current.expiresAt).getTime() - Date.now();
        setCountdown(formatCountdown(ms));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!state) return null;

  const handleExit = async () => {
    if (exiting) return;
    setExiting(true);
    try {
      await adminRevokeImpersonationSession(state.sessionId);
    } catch {
      // Best-effort — clear locally even if revocation fails
    }
    clearImpersonationState();
    // Redirect back to admin panel
    window.location.href = "/admin";
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-2 text-sm font-semibold"
      style={{
        background: "rgba(220,38,38,0.95)",
        color: "#fff",
        borderBottom: "2px solid rgba(185,28,28,1)",
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Eye size={15} aria-hidden="true" />
        <span className="truncate">
          Viewing as <strong>{state.targetUserId}</strong> — read-only
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-xs font-mono"
          style={{ background: "rgba(0,0,0,0.25)" }}
          aria-label={`Session expires in ${countdown}`}
        >
          {countdown}
        </span>
      </div>
      <button
        type="button"
        onClick={() => { void handleExit(); }}
        disabled={exiting}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition-opacity disabled:opacity-60"
        style={{ background: "rgba(0,0,0,0.3)", color: "#fff" }}
        aria-label="Exit impersonation and return to admin panel"
      >
        <LogOut size={13} aria-hidden="true" />
        {exiting ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}
