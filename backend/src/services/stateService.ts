import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import { PortfolioStateSchema } from "../schemas/portfolio.js";
import type { PortfolioState, PortfolioStateData } from "../types/index.js";

function stateFilePath(userId: string): string {
  return path.resolve(process.env["DATA_DIR"] ?? "../data", "users", userId, "data", "state.json");
}

export class StateTransitionError extends Error {
  constructor(
    message: string,
    public readonly from: PortfolioState,
    public readonly to: PortfolioState
  ) {
    super(message);
    this.name = "StateTransitionError";
  }
}

export async function readState(userId: string): Promise<PortfolioStateData> {
  const filePath = stateFilePath(userId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = PortfolioStateSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid state file: ${result.error.message}`);
    }
    return result.data as PortfolioStateData;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        userId,
        state: "UNINITIALIZED",
        lastFullReportAt: null,
        lastDailyAt: null,
        pendingDeepDives: [],
        bootstrapProgress: null,
      };
    }
    throw err;
  }
}

export async function writeState(
  userId: string,
  update: Partial<PortfolioStateData>
): Promise<void> {
  const filePath = stateFilePath(userId);
  const current = await readState(userId);
  const merged: PortfolioStateData = {
    ...current,
    ...update,
    userId,
  };
  const result = PortfolioStateSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid state after merge: ${result.error.message}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(result.data, null, 2), "utf-8");
}

const LEGAL_TRANSITIONS: Record<PortfolioState, PortfolioState[]> = {
  UNINITIALIZED: ["BOOTSTRAPPING"],
  BOOTSTRAPPING: ["ACTIVE"],
  ACTIVE: ["BOOTSTRAPPING", "UNINITIALIZED"],
};

export async function transitionState(
  userId: string,
  to: PortfolioState,
  reason: string
): Promise<void> {
  const current = await readState(userId);
  const from = current.state as PortfolioState;

  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new StateTransitionError(
      `Illegal state transition from ${from} to ${to}`,
      from,
      to
    );
  }

  logger.info(`State transition: ${from} → ${to} | reason=${reason}`);
  await writeState(userId, { state: to });
}

export interface ConditionCheckResult {
  userId: string;
  checkedAt: string;
  expiredCatalysts: Array<{ ticker: string; catalyst: string; expiredAt: string }>;
  pendingDeepDives: string[];
  summary: string;
}

export async function checkDailyConditions(
  userId: string
): Promise<ConditionCheckResult> {
  const dataDir = path.resolve(
    process.env["DATA_DIR"] ?? "../data",
    "users",
    userId,
    "data"
  );

  const tickersDir = path.join(dataDir, "tickers");
  const expiredCatalysts: ConditionCheckResult["expiredCatalysts"] = [];
  const pendingDeepDives: string[] = [];

  let tickerDirs: string[] = [];
  try {
    tickerDirs = await fs.readdir(tickersDir);
  } catch {
    // No tickers dir yet
  }

  const now = new Date();

  for (const ticker of tickerDirs) {
    const strategyPath = path.join(tickersDir, ticker, "strategy.json");
    let strategy: Record<string, unknown>;
    try {
      const raw = await fs.readFile(strategyPath, "utf-8");
      strategy = JSON.parse(raw);
    } catch {
      continue;
    }

    const catalysts = (strategy["catalysts"] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const catalyst of catalysts) {
      const expiresAt = catalyst["expiresAt"] as string | null;
      if (expiresAt && new Date(expiresAt) < now) {
        expiredCatalysts.push({
          ticker,
          catalyst: catalyst["description"] as string,
          expiredAt: expiresAt,
        });
      }
    }

    const verdict = strategy["verdict"] as string;
    if (verdict === "HOLD") {
      const hasExpiring = catalysts.some(
        (c) => c["expiresAt"] !== null && new Date(c["expiresAt"] as string) > now
      );
      if (!hasExpiring) {
        pendingDeepDives.push(ticker);
      }
    }
  }

  const summary =
    expiredCatalysts.length === 0 && pendingDeepDives.length === 0
      ? "All clear — no expired catalysts, no HOLD without catalyst"
      : `${expiredCatalysts.length} expired catalyst(s), ${pendingDeepDives.length} HOLD without catalyst`;

  return {
    userId,
    checkedAt: now.toISOString(),
    expiredCatalysts,
    pendingDeepDives,
    summary,
  };
}
