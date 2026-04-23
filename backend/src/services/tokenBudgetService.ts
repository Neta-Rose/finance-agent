import { promises as fs } from "fs";
import path from "path";
import {
  DEFAULT_TOKEN_BUDGETS,
  type TokenBudgets,
  type TokenBudgetWindow,
} from "../types/index.js";
import { resolveConfiguredPath } from "./paths.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

export interface TokenBudgetUsage {
  maxTokens: number;
  periodHours: number;
  tokensUsed: number;
  tokensRemaining: number;
  pctUsed: number;
  exhausted: boolean;
  windowStart: string;
  windowEnd: string;
}

export interface UserTokenBudgetSnapshot {
  conversation: TokenBudgetUsage;
  structured: TokenBudgetUsage;
}

function profilePath(userId: string): string {
  return path.join(USERS_DIR, userId, "profile.json");
}

export async function getUserTokenBudgets(userId: string): Promise<TokenBudgets> {
  try {
    const raw = await fs.readFile(profilePath(userId), "utf-8");
    const profile = JSON.parse(raw) as { tokenBudgets?: Partial<TokenBudgets> };
    const tokenBudgets = profile.tokenBudgets ?? {};
    return {
      conversation: {
        ...DEFAULT_TOKEN_BUDGETS.conversation,
        ...(tokenBudgets.conversation ?? {}),
      },
      structured: {
        ...DEFAULT_TOKEN_BUDGETS.structured,
        ...(tokenBudgets.structured ?? {}),
      },
    };
  } catch {
    return DEFAULT_TOKEN_BUDGETS;
  }
}

export async function setUserTokenBudgets(
  userId: string,
  patch: Partial<TokenBudgets>
): Promise<TokenBudgets> {
  let profile: Record<string, unknown> = {};
  try {
    profile = JSON.parse(await fs.readFile(profilePath(userId), "utf-8")) as Record<string, unknown>;
  } catch {}

  const current = await getUserTokenBudgets(userId);
  const next: TokenBudgets = {
    conversation: {
      ...current.conversation,
      ...(patch.conversation ?? {}),
    },
    structured: {
      ...current.structured,
      ...(patch.structured ?? {}),
    },
  };

  profile["tokenBudgets"] = next;
  await fs.writeFile(profilePath(userId), JSON.stringify(profile, null, 2), "utf-8");
  return next;
}

export function buildTokenBudgetUsage(
  window: TokenBudgetWindow,
  tokensUsed: number,
  now = new Date()
): TokenBudgetUsage {
  const maxTokens = Math.max(1, window.maxTokens);
  const periodHours = Math.max(1, window.periodHours);
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - periodHours * 3600 * 1000).toISOString();
  const boundedTokensUsed = Math.max(0, tokensUsed);
  const pctUsed = Math.min(999, Math.round((boundedTokensUsed / maxTokens) * 100));
  const exhausted = boundedTokensUsed >= maxTokens;

  return {
    maxTokens,
    periodHours,
    tokensUsed: boundedTokensUsed,
    tokensRemaining: Math.max(0, maxTokens - boundedTokensUsed),
    pctUsed,
    exhausted,
    windowStart,
    windowEnd,
  };
}
