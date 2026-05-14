/**
 * Impersonation store — S07 (Pilot Operational Visibility)
 *
 * Tracks the active read-only impersonation session in sessionStorage.
 * The token is stored separately from the normal auth token so it never
 * replaces the admin's own session.
 *
 * sessionStorage keys:
 *   impersonation_token      — the short-lived JWT
 *   impersonation_session_id — the session ID for revocation
 *   impersonation_target_id  — the target user ID (display only)
 *   impersonation_expires_at — ISO timestamp for countdown
 */

const TOKEN_KEY = "impersonation_token";
const SESSION_KEY = "impersonation_session_id";
const TARGET_KEY = "impersonation_target_id";
const EXPIRES_KEY = "impersonation_expires_at";

export interface ImpersonationState {
  token: string;
  sessionId: string;
  targetUserId: string;
  expiresAt: string;
}

export function getImpersonationState(): ImpersonationState | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const sessionId = sessionStorage.getItem(SESSION_KEY);
    const targetUserId = sessionStorage.getItem(TARGET_KEY);
    const expiresAt = sessionStorage.getItem(EXPIRES_KEY);
    if (!token || !sessionId || !targetUserId || !expiresAt) return null;
    // Auto-clear if expired
    if (new Date(expiresAt) <= new Date()) {
      clearImpersonationState();
      return null;
    }
    return { token, sessionId, targetUserId, expiresAt };
  } catch {
    return null;
  }
}

export function setImpersonationState(state: ImpersonationState): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, state.token);
    sessionStorage.setItem(SESSION_KEY, state.sessionId);
    sessionStorage.setItem(TARGET_KEY, state.targetUserId);
    sessionStorage.setItem(EXPIRES_KEY, state.expiresAt);
  } catch {
    // sessionStorage unavailable — silently fail
  }
}

export function clearImpersonationState(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(TARGET_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
  } catch {
    // ignore
  }
}

export function getImpersonationToken(): string | null {
  return getImpersonationState()?.token ?? null;
}
