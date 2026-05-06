/**
 * Confirmation store — Phase 5, task 5.8.
 *
 * Spec: design.md §7.4; E2.2.
 *
 * In-memory, per-conversation pending-action store. Bridges the two-turn
 * confirmation handshake: the agent proposes an action in turn N, the user
 * confirms in turn N+1, and the action executes.
 *
 * Entries expire after 15 minutes to prevent stale confirmations.
 */

export interface PendingAction {
  toolUseId: string;
  toolName: string;
  args: unknown;
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, PendingAction>();

export function put(conversationId: string, action: PendingAction): void {
  store.set(conversationId, action);
}

export function peek(conversationId: string): PendingAction | null {
  const entry = store.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(conversationId);
    return null;
  }
  return entry;
}

export function clear(conversationId: string): void {
  store.delete(conversationId);
}

/**
 * Parse a user reply to determine if it's a confirmation or denial.
 * Returns "confirm", "deny", or "unclear".
 */
export function parseConfirmation(text: string): "confirm" | "deny" | "unclear" {
  const lower = text.trim().toLowerCase();
  if (["yes", "y", "ok", "confirm", "go", "do it", "proceed", "sure", "yep", "yeah"].includes(lower)) {
    return "confirm";
  }
  if (["no", "n", "cancel", "stop", "nope", "nah", "skip", "abort", "don't", "dont"].includes(lower)) {
    return "deny";
  }
  return "unclear";
}

/** Prune expired entries. Call periodically. */
export function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.createdAt > TTL_MS) store.delete(key);
  }
}
