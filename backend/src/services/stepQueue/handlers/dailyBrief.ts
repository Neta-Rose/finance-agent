import { z } from "zod";
import type { UserWorkspace } from "../../../middleware/userIsolation.js";
import { loadStrategyFile } from "../../strategyFileService.js";
import { findActiveSnooze } from "../../snoozeStore.js";
import { admitOrReuseStepQueueJob } from "../admission.js";
import { ensurePointsBudgetAvailable } from "../../pointsBudgetService.js";
import { requiresBudgetAdmission } from "../../jobAdmissionService.js";
import { atomicWriteJson } from "../artifactIO.js";
import { logger } from "../../logger.js";
import type { StepHandler, StepInputs, ValidationResult } from "../handlers.js";
import type { ClaimedStepWorkItem } from "../types.js";
import path from "path";
import { createHash } from "crypto";

/**
 * tracking.evaluate — step-queue handler for evaluating a tracked (non-held)
 * asset during the daily brief.
 *
 * Spec: design.md §10; tasks.md 2.3.
 *
 * Evaluates whether a tracked idea should be escalated to a deep dive based
 * on its strategy health (staleness, verdict, catalyst state). Deterministic
 * — no LLM call.
 */

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const TrackingEvaluateResultSchema = z.object({
  ticker: z.string(),
  evaluatedAt: z.string().datetime(),
  assetScope: z.enum(["portfolio", "tracking"]),
  trackingStatus: z.string().nullable(),
  signals: z.array(z.string()),
  signalSetFingerprint: z.string(),
  shouldEscalate: z.boolean(),
  escalationReason: z.string().nullable(),
  escalatedToJobId: z.string().nullable(),
  snoozeSuppressed: z.boolean(),
});

export type TrackingEvaluateResult = z.infer<typeof TrackingEvaluateResultSchema>;

// ---------------------------------------------------------------------------
// Signal computation
// ---------------------------------------------------------------------------

function computeFingerprint(signals: string[]): string {
  const canonical = JSON.stringify([...signals].sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

async function computeTrackingSignals(
  ws: UserWorkspace,
  ticker: string
): Promise<{ signals: string[]; shouldEscalate: boolean }> {
  const signals: string[] = [];
  const now = Date.now();

  const loaded = await loadStrategyFile(ws.strategyFile(ticker), {
    repair: false,
    tickerHint: ticker,
  });

  if (!loaded.valid || !loaded.strategy) {
    signals.push("strategy_invalid_or_missing");
    return { signals, shouldEscalate: true };
  }

  const strategy = loaded.strategy;

  // Never had a deep dive — always escalate for tracked ideas
  if (strategy.lastDeepDiveAt === null) {
    signals.push("no_deep_dive_ever");
    return { signals, shouldEscalate: true };
  }

  // Stale deep dive (>30 days)
  const daysSince = (now - new Date(strategy.lastDeepDiveAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > 30) {
    signals.push(`stale_${Math.floor(daysSince)}d_since_deep_dive`);
  }

  // Expired catalysts
  const expiredCatalysts = (strategy.catalysts ?? []).filter(
    (c) => c.expiresAt !== null && !c.triggered && new Date(c.expiresAt).getTime() < now
  );
  if (expiredCatalysts.length > 0) {
    signals.push(`${expiredCatalysts.length}_catalyst_expired`);
  }

  // Tracking status changes that warrant a review
  if (strategy.trackingStatus === "muted") {
    // Muted ideas are not escalated
    return { signals: [], shouldEscalate: false };
  }

  // Escalate if any signals fired
  const shouldEscalate = signals.length > 0;
  return { signals, shouldEscalate };
}

// ---------------------------------------------------------------------------
// StepHandler implementation
// ---------------------------------------------------------------------------

export const trackingEvaluateHandler: StepHandler<TrackingEvaluateResult> = {
  kind: "tracking.evaluate",

  async gatherInputs(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<StepInputs> {
    return {
      step,
      workspace: ws,
      gatheredAt: new Date().toISOString(),
      data: {},
    };
  },

  buildPrompt(inputs, _tier) {
    return {
      system: "",
      user: `tracking.evaluate for ${inputs.step.ticker}`,
      schema: TrackingEvaluateResultSchema,
    };
  },

  async call(_prompt, _model, _step, inputs) {
    return inputs?.data["result"] ?? null;
  },

  validate(raw): ValidationResult<TrackingEvaluateResult> {
    const parsed = TrackingEvaluateResultSchema.safeParse(raw);
    if (parsed.success) return { ok: true, artifact: parsed.data };
    return { ok: false, error: parsed.error };
  },

  async persistArtifact(artifact, ws, step) {
    const filePath = path.join(ws.reportsDir, step.ticker, "tracking_evaluate.json");
    await atomicWriteJson(filePath, artifact);
    return filePath;
  },
};

// ---------------------------------------------------------------------------
// Direct execution entry point
// ---------------------------------------------------------------------------

export async function executeTrackingEvaluateStep(
  step: ClaimedStepWorkItem,
  ws: UserWorkspace
): Promise<TrackingEvaluateResult> {
  const loaded = await loadStrategyFile(ws.strategyFile(step.ticker), {
    repair: false,
    tickerHint: step.ticker,
  });

  const assetScope = loaded.strategy?.assetScope ?? "tracking";
  const trackingStatus = loaded.strategy?.trackingStatus ?? null;

  const { signals, shouldEscalate } = await computeTrackingSignals(ws, step.ticker);
  const fingerprint = computeFingerprint(signals);

  let escalatedToJobId: string | null = null;
  let snoozeSuppressed = false;
  let escalationReason: string | null = null;

  if (shouldEscalate) {
    // Check snooze suppression
    const snooze = await findActiveSnooze(ws.userId, step.ticker, fingerprint);
    if (snooze) {
      snoozeSuppressed = true;
      logger.info(
        `tracking.evaluate: snooze suppressed escalation user=${ws.userId} ticker=${step.ticker}`
      );
    } else {
      const budgetGate = await ensurePointsBudgetAvailable(ws.userId);
      if (budgetGate.allowed) {
        const admitted = await admitOrReuseStepQueueJob({
          workspace: ws,
          action: "deep_dive",
          ticker: step.ticker,
          source: "backend_job",
          budgetAdmittedAt: requiresBudgetAdmission({ action: "deep_dive" }) ? new Date() : null,
        });
        escalatedToJobId = admitted.jobId;
        escalationReason = signals.join("; ");
      }
    }
  }

  const result: TrackingEvaluateResult = {
    ticker: step.ticker,
    evaluatedAt: new Date().toISOString(),
    assetScope: assetScope as "portfolio" | "tracking",
    trackingStatus,
    signals,
    signalSetFingerprint: fingerprint,
    shouldEscalate,
    escalationReason,
    escalatedToJobId,
    snoozeSuppressed,
  };

  const filePath = path.join(ws.reportsDir, step.ticker, "tracking_evaluate.json");
  await atomicWriteJson(filePath, result);
  return result;
}
