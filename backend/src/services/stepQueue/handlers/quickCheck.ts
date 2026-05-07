import { createHash } from "crypto";
import { z } from "zod";
import type { UserWorkspace } from "../../../middleware/userIsolation.js";
import { getPrice, getUsdIlsRate } from "../../priceService.js";
import { PortfolioFileSchema } from "../../../schemas/portfolio.js";
import { loadStrategyFile } from "../../strategyFileService.js";
import { findActiveSnooze } from "../../snoozeStore.js";
import { recordEscalation } from "../../escalationHistoryStore.js";
import { logger } from "../../logger.js";
import { admitOrReuseStepQueueJob } from "../admission.js";
import { ensurePointsBudgetAvailable } from "../../pointsBudgetService.js";
import { requiresBudgetAdmission } from "../../jobAdmissionService.js";
import { isApplicationDatabaseConfigured } from "../../../db/applicationDataSource.js";
import { atomicWriteJson } from "../artifactIO.js";
import type { StepHandler, StepInputs, ValidationResult } from "../handlers.js";
import type { ClaimedStepWorkItem } from "../types.js";
import { promises as fs } from "fs";
import path from "path";

/**
 * quick_check.evaluate — step-queue handler for the quick-check step kind.
 *
 * Spec: design.md §10; tasks.md 2.2.
 *
 * Computes a signal set from live price + existing strategy + sentiment
 * artifact, decides whether to escalate to a deep dive, and records the
 * escalation in both the legacy JSON file and the `escalation_history` table.
 *
 * This handler is intentionally deterministic — it does NOT call an LLM.
 * The LLM-based advisor path from the legacy `quickCheckService` is preserved
 * for backward compatibility but is not invoked here; the step-queue path
 * uses only deterministic signals. The LLM advisor is a Phase 4 enhancement.
 */

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const QuickCheckResultSchema = z.object({
  ticker: z.string(),
  evaluatedAt: z.string().datetime(),
  signals: z.array(z.string()),
  signalSetFingerprint: z.string(),
  score: z.number().int().min(0).max(100),
  shouldEscalate: z.boolean(),
  escalationReason: z.string().nullable(),
  escalatedToJobId: z.string().nullable(),
  snoozeSuppressed: z.boolean(),
});

export type QuickCheckResult = z.infer<typeof QuickCheckResultSchema>;

// ---------------------------------------------------------------------------
// Signal computation (deterministic, no LLM)
// ---------------------------------------------------------------------------

function computeSignalSetFingerprint(signals: string[]): string {
  const canonical = JSON.stringify([...signals].sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

interface SignalSet {
  signals: string[];
  score: number;
}

async function computeSignals(
  ws: UserWorkspace,
  ticker: string,
  usdIlsRate: number
): Promise<SignalSet> {
  const signals: string[] = [];
  let score = 100;
  const now = Date.now();

  // 1. Strategy health
  const loaded = await loadStrategyFile(ws.strategyFile(ticker), {
    repair: false,
    tickerHint: ticker,
  });
  if (!loaded.valid || !loaded.strategy) {
    signals.push("strategy_invalid_or_missing");
    return { signals, score: 0 };
  }
  const strategy = loaded.strategy;

  // 2. Expired catalysts
  const expiredCatalysts = (strategy.catalysts ?? []).filter(
    (c) => c.expiresAt !== null && !c.triggered && new Date(c.expiresAt).getTime() < now
  );
  if (expiredCatalysts.length > 0) {
    signals.push(`${expiredCatalysts.length}_catalyst_expired`);
    score -= 45;
  }

  // 3. HOLD without future catalyst
  const hasFutureCatalyst = (strategy.catalysts ?? []).some(
    (c) => c.expiresAt !== null && !c.triggered && new Date(c.expiresAt).getTime() >= now
  );
  if (strategy.verdict === "HOLD" && !hasFutureCatalyst) {
    signals.push("hold_no_future_catalyst");
    score -= 35;
  }

  // 4. Stale strategy (no deep dive in >30 days)
  if (strategy.lastDeepDiveAt === null) {
    signals.push("no_deep_dive_ever");
    score -= 20;
  } else {
    const daysSince = (now - new Date(strategy.lastDeepDiveAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 30) {
      signals.push(`stale_${Math.floor(daysSince)}d_since_deep_dive`);
      score -= 15;
    }
  }

  // 5. Price drawdown from cost basis
  try {
    const raw = await fs.readFile(ws.portfolioFile, "utf-8");
    const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
    const allPositions = Object.values(portfolio.accounts).flat();
    const position = allPositions.find((p) => p.ticker === ticker);
    if (position) {
      const priceResult = await getPrice(ticker, position.exchange, usdIlsRate);
      const livePrice = priceResult.priceNative;
      const avgPrice = position.unitAvgBuyPrice;
      if (avgPrice > 0 && livePrice > 0) {
        const drawdownPct = ((avgPrice - livePrice) / avgPrice) * 100;
        if (drawdownPct >= 30) {
          signals.push(`drawdown_${Math.floor(drawdownPct)}pct`);
          score -= 40;
        } else if (drawdownPct >= 15) {
          signals.push(`drawdown_${Math.floor(drawdownPct)}pct`);
          score -= 15;
        }
      }
    }
  } catch {
    // Price fetch failure is not a signal; the step still completes.
  }

  // 6. Sentiment deterioration (from existing artifact if present)
  try {
    const sentimentPath = ws.reportFile(ticker, "sentiment");
    const raw = await fs.readFile(sentimentPath, "utf-8");
    const sentiment = JSON.parse(raw) as { narrativeShift?: string };
    if (sentiment.narrativeShift === "deteriorating") {
      signals.push("sentiment_deteriorating");
      score -= 20;
    }
  } catch {
    // No sentiment artifact yet — not a signal.
  }

  return { signals, score: Math.max(0, score) };
}

// ---------------------------------------------------------------------------
// Escalation logic
// ---------------------------------------------------------------------------

async function maybeEscalate(
  ws: UserWorkspace,
  ticker: string,
  signals: string[],
  fingerprint: string,
  _jobId: string
): Promise<{ escalatedToJobId: string | null; snoozeSuppressed: boolean }> {
  if (!isApplicationDatabaseConfigured()) {
    logger.info(
      `quick_check.evaluate: skipping escalation because application database is not configured user=${ws.userId} ticker=${ticker}`
    );
    return { escalatedToJobId: null, snoozeSuppressed: false };
  }

  // Check snooze suppression (Phase 7 wires the full snooze path; for now
  // the store is live and the check is real).
  const snooze = await findActiveSnooze(ws.userId, ticker, fingerprint);
  if (snooze) {
    logger.info(
      `quick_check.evaluate: snooze suppressed escalation user=${ws.userId} ticker=${ticker} fingerprint=${fingerprint}`
    );
    return { escalatedToJobId: null, snoozeSuppressed: true };
  }

  // Budget gate
  const budgetGate = await ensurePointsBudgetAvailable(ws.userId);
  if (!budgetGate.allowed) {
    logger.info(
      `quick_check.evaluate: budget exhausted, skipping escalation user=${ws.userId} ticker=${ticker}`
    );
    return { escalatedToJobId: null, snoozeSuppressed: false };
  }

  // Admit a deep-dive job
  const admitted = await admitOrReuseStepQueueJob({
    workspace: ws,
    action: "deep_dive",
    ticker,
    source: "backend_job",
    budgetAdmittedAt: requiresBudgetAdmission({ action: "deep_dive" }) ? new Date() : null,
  });

  // Record escalation in both legacy JSON and Postgres
  try {
    await recordEscalation({
      userId: ws.userId,
      ticker,
      signalSetFingerprint: fingerprint,
      jobId: admitted.jobId,
      signals: [...signals].sort(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      `quick_check.evaluate: escalation_history write failed user=${ws.userId} ticker=${ticker} error=${message}`
    );
  }

  return { escalatedToJobId: admitted.jobId, snoozeSuppressed: false };
}

// ---------------------------------------------------------------------------
// StepHandler implementation
// ---------------------------------------------------------------------------

export const quickCheckHandler: StepHandler<QuickCheckResult> = {
  kind: "quick_check.evaluate",

  async gatherInputs(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<StepInputs> {
    const usdIlsRate = await getUsdIlsRate();
    return {
      step,
      workspace: ws,
      gatheredAt: new Date().toISOString(),
      data: { usdIlsRate },
    };
  },

  buildPrompt(inputs, _tier) {
    // quick_check.evaluate is deterministic — no LLM prompt.
    return {
      system: "",
      user: `quick_check.evaluate for ${inputs.step.ticker}`,
      schema: QuickCheckResultSchema,
      schemaName: "QuickCheckResultSchema",
    };
  },

  // The executor bypasses the LLM for this deterministic step kind and calls
  // executeQuickCheckStep directly. This `call` implementation is never reached.
  async call(_prompt, _model, _step, inputs) {
    return (inputs?.data["result"] ?? null) as QuickCheckResult;
  },

  validate(raw, _schema, _inputs): ValidationResult<QuickCheckResult> {
    const parsed = QuickCheckResultSchema.safeParse(raw);
    if (parsed.success) return { ok: true, artifact: parsed.data };
    return { ok: false, error: parsed.error };
  },

  async persistArtifact(artifact, ws, step) {
    const filePath = path.join(ws.reportsDir, step.ticker, "quick_check.json");
    await atomicWriteJson(filePath, artifact);
    return filePath;
  },
};

// ---------------------------------------------------------------------------
// Direct execution entry point (called by the executor for this step kind)
// ---------------------------------------------------------------------------

/**
 * Execute a quick_check.evaluate step directly (no LLM round-trip).
 * Returns the QuickCheckResult and persists the artifact.
 *
 * The executor calls this instead of the normal prompt→call→validate loop
 * when it detects `kind === 'quick_check.evaluate'`.
 */
export async function executeQuickCheckStep(
  step: ClaimedStepWorkItem,
  ws: UserWorkspace
): Promise<QuickCheckResult> {
  const usdIlsRate = await getUsdIlsRate();
  const { signals, score } = await computeSignals(ws, step.ticker, usdIlsRate);
  const fingerprint = computeSignalSetFingerprint(signals);
  const shouldEscalate = score < 60 && signals.length > 0;

  let escalatedToJobId: string | null = null;
  let snoozeSuppressed = false;
  let escalationReason: string | null = null;

  if (shouldEscalate) {
    const escalation = await maybeEscalate(ws, step.ticker, signals, fingerprint, step.jobId);
    escalatedToJobId = escalation.escalatedToJobId;
    snoozeSuppressed = escalation.snoozeSuppressed;
    escalationReason = signals.join("; ");
  }

  const result: QuickCheckResult = {
    ticker: step.ticker,
    evaluatedAt: new Date().toISOString(),
    signals,
    signalSetFingerprint: fingerprint,
    score,
    shouldEscalate,
    escalationReason,
    escalatedToJobId,
    snoozeSuppressed,
  };

  const filePath = path.join(ws.reportsDir, step.ticker, "quick_check.json");
  await atomicWriteJson(filePath, result);
  return result;
}
