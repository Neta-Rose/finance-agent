import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "./paths.js";
import { logger } from "./logger.js";
import { readStrategy, writeStrategy, type StrategyRecord, type StrategyAssetClass, type StrategyAssetScope, type StrategyConfidence, type StrategyVerdict } from "./strategyStore.js";
import type { Strategy } from "../schemas/strategy.js";

/**
 * Strategy export — derived JSON-file projection of the `strategies` row.
 *
 * Spec: design.md §6.1 strategyExportService; A2.3.
 *
 * The DB row is the source of truth (A2.1, A2.2). This module regenerates the
 * legacy `users/[id]/data/tickers/[T]/strategy.json` file deterministically
 * from a row, for backward compatibility with any code path that still reads
 * the file. Once Phase 2 cuts every reader over to the DB, the file ceases to
 * matter; we keep regenerating it through Phase 3 to make rollback safe.
 */

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

function strategyFilePathForUser(userId: string, ticker: string): string {
  return path.join(USERS_DIR, userId, "data", "tickers", ticker, "strategy.json");
}

/**
 * Render a `StrategyRecord` into the legacy JSON shape consumed by
 * `loadStrategyFile`. The shape mirrors `backend/src/schemas/strategy.ts`
 * (StrategySchema) — keys are camelCase ISO-stringified.
 */
export function renderStrategyJson(record: StrategyRecord): Record<string, unknown> {
  const json: Record<string, unknown> = {
    ticker: record.ticker,
    updatedAt: record.updatedAt,
    version: record.version,
    verdict: record.verdict,
    confidence: record.confidence,
    reasoning: record.reasoning,
    timeframe: record.timeframe,
    positionSizeILS: record.positionSizeIls,
    positionWeightPct: record.positionWeightPct,
    entryConditions: record.entryConditions,
    exitConditions: record.exitConditions,
    catalysts: record.catalysts,
    bullCase: record.bullCase,
    bearCase: record.bearCase,
    lastDeepDiveAt: record.lastDeepDiveAt,
    deepDiveTriggeredBy: record.deepDiveTriggeredBy,
    metadata: record.metadata,
    actionCatalysts: record.actionCatalysts,
    avoidConditions: record.avoidConditions,
  };

  if (record.assetScope) json["assetScope"] = record.assetScope;
  if (record.trackingStatus) json["trackingStatus"] = record.trackingStatus;
  if (record.stance !== null) json["stance"] = record.stance;
  if (record.potentialScore !== null) json["potentialScore"] = record.potentialScore;
  if (record.urgencyScore !== null) json["urgencyScore"] = record.urgencyScore;
  if (record.urgencyLabel !== null) json["urgencyLabel"] = record.urgencyLabel;
  if (record.portfolioFitScore !== null) json["portfolioFitScore"] = record.portfolioFitScore;
  if (record.suggestedAllocationPct !== null) json["suggestedAllocationPct"] = record.suggestedAllocationPct;
  if (record.suggestedAllocationIls !== null) json["suggestedAllocationILS"] = record.suggestedAllocationIls;
  if (record.nextReviewAt !== null) json["nextReviewAt"] = record.nextReviewAt;

  return json;
}

/**
 * Write the derived JSON file from a record. Atomic via temp file + rename.
 */
export async function exportStrategyToFile(record: StrategyRecord): Promise<void> {
  const targetPath = strategyFilePathForUser(record.userId, record.ticker);
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const json = renderStrategyJson(record);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(json, null, 2), "utf-8");
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Read the latest record from the DB and re-export its derived JSON file.
 * Logs and swallows export failures so they cannot break the canonical write.
 */
export async function regenerateStrategyExport(userId: string, ticker: string): Promise<void> {
  try {
    const record = await readStrategy(userId, ticker);
    if (!record) return;
    await exportStrategyToFile(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`strategy_export_failed user=${userId} ticker=${ticker} error=${message}`);
  }
}


/**
 * Map a `Strategy` (Zod schema instance) into the Postgres write input.
 * Centralized so synthesis, full-report promotion, and catalyst marking all
 * agree on field naming and default handling.
 */
export function strategyToWriteInput(
  strategy: Strategy,
  userId: string,
  options?: { assetClass?: StrategyAssetClass }
) {
  return {
    userId,
    ticker: strategy.ticker,
    assetScope: (strategy.assetScope ?? "portfolio") as StrategyAssetScope,
    trackingStatus: strategy.trackingStatus ?? null,
    verdict: strategy.verdict as StrategyVerdict,
    confidence: strategy.confidence as StrategyConfidence,
    reasoning: strategy.reasoning,
    timeframe: strategy.timeframe,
    positionSizeIls: strategy.positionSizeILS,
    positionWeightPct: strategy.positionWeightPct,
    entryConditions: strategy.entryConditions ?? [],
    exitConditions: strategy.exitConditions ?? [],
    catalysts: (strategy.catalysts ?? []).map((c) => ({
      description: c.description,
      expiresAt: c.expiresAt,
      triggered: c.triggered,
    })),
    bullCase: strategy.bullCase ?? null,
    bearCase: strategy.bearCase ?? null,
    lastDeepDiveAt: strategy.lastDeepDiveAt ?? null,
    deepDiveTriggeredBy: strategy.deepDiveTriggeredBy ?? null,
    metadata: (strategy.metadata as unknown as Record<string, unknown>) ?? {},
    stance: strategy.stance ?? null,
    potentialScore: strategy.potentialScore ?? null,
    urgencyScore: strategy.urgencyScore ?? null,
    urgencyLabel: strategy.urgencyLabel ?? null,
    portfolioFitScore: strategy.portfolioFitScore ?? null,
    suggestedAllocationPct: strategy.suggestedAllocationPct ?? null,
    suggestedAllocationIls: strategy.suggestedAllocationILS ?? null,
    actionCatalysts: (strategy.actionCatalysts ?? []).map((c) => ({
      description: c.description,
      expiresAt: c.expiresAt,
      triggered: c.triggered,
    })),
    avoidConditions: strategy.avoidConditions ?? [],
    nextReviewAt: strategy.nextReviewAt ?? null,
    assetClass: (options?.assetClass ?? "equity") as StrategyAssetClass,
  };
}

/**
 * Phase 1 dual-write helper. Writes a parsed `Strategy` to the `strategies`
 * table; logs and swallows DB failures so they cannot block the legacy JSON
 * write that remains the source of truth this phase.
 */
export async function dualWriteStrategy(
  strategy: Strategy,
  userId: string,
  options?: { assetClass?: StrategyAssetClass }
): Promise<void> {
  try {
    await writeStrategy(strategyToWriteInput(strategy, userId, options));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`strategy_dual_write_failed user=${userId} ticker=${strategy.ticker} error=${message}`);
  }
}
