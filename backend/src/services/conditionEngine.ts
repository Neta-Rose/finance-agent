
import { promises as fs } from "fs";
import { logger } from "./logger.js";
import { getWorkspace } from "./workspaceService.js";
import { readState, writeState } from "./stateService.js";
import { StrategySchema } from "../schemas/strategy.js";


// ── Types ────────────────────────────────────────────────────────────────────

export type EscalationReason =
  | "catalyst_expired"
  | "hold_no_catalyst"
  | "stale_low_confidence"
  | "pending_deep_dive"
  | "manual_trigger";

export interface ExpiredCatalystInfo {
  description: string;
  expiredAt: string;
  daysOverdue: number;
}

export interface TickerConditionResult {
  ticker: string;
  needsEscalation: boolean;
  escalationReasons: EscalationReason[];
  escalationDetails: string[];
  lastDeepDiveAt: string | null;
  daysSinceDeepDive: number | null;
  verdict: string;
  confidence: string;
  expiredCatalysts: ExpiredCatalystInfo[];
  onTrack: boolean;
}

export interface ConditionReport {
  userId: string;
  generatedAt: string;
  totalTickers: number;
  needsEscalation: TickerConditionResult[];
  onTrack: TickerConditionResult[];
  errors: Array<{ ticker: string; error: string }>;
  summary: string;
}

const REASON_ORDER: Record<EscalationReason, number> = {
  catalyst_expired: 1,
  hold_no_catalyst: 2,
  stale_low_confidence: 3,
  pending_deep_dive: 4,
  manual_trigger: 5,
};

function reasonOrder(r: EscalationReason): number {
  return REASON_ORDER[r] ?? 99;
}

// ── Core Engine ──────────────────────────────────────────────────────────────

export async function runConditionCheck(userId: string): Promise<ConditionReport> {
  const ws = await getWorkspace(userId);
  const now = new Date();

  let state = await readState(userId);
  const pendingDeepDives = new Set<string>(state.pendingDeepDives ?? []);

  let tickerDirs: string[] = [];
  try {
    tickerDirs = await fs.readdir(ws.tickersDir);
  } catch {
    // tickers dir doesn't exist yet
  }

  const needsEscalation: TickerConditionResult[] = [];
  const onTrack: TickerConditionResult[] = [];
  const errors: Array<{ ticker: string; error: string }> = [];
  const tickersNeedingEscalation = new Set<string>();

  for (const ticker of tickerDirs) {
    const strategyPath = ws.strategyFile(ticker);
    let raw: string;
    try {
      raw = await fs.readFile(strategyPath, "utf-8");
    } catch {
      errors.push({ ticker, error: "Could not read strategy file" });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({ ticker, error: "Invalid JSON" });
      continue;
    }

    const result = StrategySchema.safeParse(parsed);
    if (!result.success) {
      errors.push({ ticker, error: `Schema validation failed: ${result.error.errors.map((e) => e.message).join("; ")}` });
      continue;
    }

    const s = result.data;

    const reasons: EscalationReason[] = [];
    const details: string[] = [];
    const expiredCatalysts: ExpiredCatalystInfo[] = [];

    // 1. Expired catalysts
    for (const cat of s.catalysts ?? []) {
      if (cat.expiresAt === null || cat.triggered) continue;
      const expDate = new Date(cat.expiresAt);
      if (expDate < now) {
        const daysOverdue = Math.round((now.getTime() - expDate.getTime()) / (1000 * 60 * 60 * 24));
        reasons.push("catalyst_expired");
        expiredCatalysts.push({ description: cat.description, expiredAt: cat.expiresAt, daysOverdue });
        details.push(`Catalyst expired: "${cat.description}" (${daysOverdue} days overdue)`);
        tickersNeedingEscalation.add(ticker);
      }
    }

    // 2. HOLD with no future-dated catalyst
    if (s.verdict === "HOLD") {
      const hasFutureCatalyst = (s.catalysts ?? []).some(
        (c) => c.expiresAt !== null && new Date(c.expiresAt) >= now
      );
      if (!hasFutureCatalyst) {
        reasons.push("hold_no_catalyst");
        details.push("HOLD verdict with no future-dated catalyst — rules violation");
        tickersNeedingEscalation.add(ticker);
      }
    }

    // 3. Stale low confidence (never analyzed or >30 days)
    const lastDD = s.lastDeepDiveAt;
    let daysSince = null;
    if (lastDD !== null) {
      daysSince = Math.round((now.getTime() - new Date(lastDD).getTime()) / (1000 * 60 * 60 * 24));
    }
    const isStale = lastDD === null || (daysSince !== null && daysSince > 30);
    if (isStale && s.confidence === "low") {
      reasons.push("stale_low_confidence");
      details.push(
        lastDD === null
          ? "Never deep-dived with low confidence — needs first analysis"
          : `Last analysis ${daysSince} days ago (>30 days), confidence still low`
      );
      tickersNeedingEscalation.add(ticker);
    }

    // 4. Already pending
    if (pendingDeepDives.has(ticker)) {
      reasons.push("pending_deep_dive");
      details.push("Deep dive already pending in queue");
      tickersNeedingEscalation.add(ticker);
    }

    const tickerResult: TickerConditionResult = {
      ticker,
      needsEscalation: reasons.length > 0,
      escalationReasons: reasons,
      escalationDetails: details,
      lastDeepDiveAt: lastDD,
      daysSinceDeepDive: daysSince,
      verdict: s.verdict,
      confidence: s.confidence,
      expiredCatalysts,
      onTrack: reasons.length === 0,
    };

    if (tickerResult.needsEscalation) {
      needsEscalation.push(tickerResult);
    } else {
      onTrack.push(tickerResult);
    }
  }

  // Sort needsEscalation by reason urgency
  needsEscalation.sort((a, b) => {
    const ao = reasonOrder(a.escalationReasons[0] ?? "manual_trigger");
    const bo = reasonOrder(b.escalationReasons[0] ?? "manual_trigger");
    if (ao !== bo) return ao - bo;
    return a.ticker.localeCompare(b.ticker);
  });

  // Update pendingDeepDives in state
  const updatedPending = Array.from(
    new Set([...pendingDeepDives, ...Array.from(tickersNeedingEscalation)])
  );
  if (
    updatedPending.length !== pendingDeepDives.size ||
    !updatedPending.every((t) => pendingDeepDives.has(t))
  ) {
    await writeState(userId, { pendingDeepDives: updatedPending });
  }

  const summary =
    `${needsEscalation.length} ticker${needsEscalation.length !== 1 ? "s" : ""} need attention, ${onTrack.length} on track`;

  return {
    userId,
    generatedAt: new Date().toISOString(),
    totalTickers: tickerDirs.length,
    needsEscalation,
    onTrack,
    errors,
    summary,
  };
}

// ── markCatalystTriggered ────────────────────────────────────────────────────

export async function markCatalystTriggered(
  userId: string,
  ticker: string,
  catalystDescription: string
): Promise<void> {
  const ws = await getWorkspace(userId);
  const strategyPath = ws.strategyFile(ticker);

  const raw = await fs.readFile(strategyPath, "utf-8");
  const parsed = JSON.parse(raw);
  const result = StrategySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid strategy for ${ticker}: ${result.error.errors.map((e) => e.message).join("; ")}`);
  }

  const s = result.data;
  let found = false;

  for (const cat of s.catalysts ?? []) {
    if (cat.description === catalystDescription) {
      cat.triggered = true;
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error(`Catalyst not found: "${catalystDescription}"`);
  }

  s.updatedAt = new Date().toISOString();
  s.version = (s.version ?? 1) + 1;

  await fs.writeFile(strategyPath, JSON.stringify(s, null, 2), "utf-8");
  logger.info(`Marked catalyst triggered: ${ticker} — "${catalystDescription}"`);
}

// ── markDeepDiveComplete ─────────────────────────────────────────────────────

export async function markDeepDiveComplete(userId: string, ticker: string): Promise<void> {
  const ws = await getWorkspace(userId);
  const stateFile = ws.stateFile;

  const raw = await fs.readFile(stateFile, "utf-8");
  const state = JSON.parse(raw);

  const pending = state.pendingDeepDives ?? [];
  const updated = pending.filter((t: string) => t !== ticker);

  await fs.writeFile(
    stateFile,
    JSON.stringify(
      {
        ...state,
        pendingDeepDives: updated,
        lastDailyAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );

  logger.info(`Deep dive complete: ${ticker}`);
}
