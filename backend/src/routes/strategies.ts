import { Router, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Verdict, Confidence } from "../types/index.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { loadStrategyFile } from "../services/strategyFileService.js";
import { logger } from "../services/logger.js";
import { listTrackedAssets, type TrackedAssetStatus } from "../services/trackedAssetService.js";
import { listStrategies, readStrategy, type StrategyRecord } from "../services/strategyStore.js";
import { isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";

const router = Router();

type AsyncHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void>;

function handler(fn: AsyncHandler) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const VERDICT_SORT_ORDER: Record<string, number> = {
  SELL: 1,
  CLOSE: 2,
  REDUCE: 3,
  HOLD: 4,
  ADD: 5,
  BUY: 6,
};

const TICKER_REGEX = /^[A-Z0-9.]{1,12}$/;
type StrategyScope = "portfolio" | "tracking";

interface StrategyListRow {
  ticker: string;
  inPortfolio: boolean;
  scope: StrategyScope;
  trackingStatus: TrackedAssetStatus | null;
  verdict: Verdict;
  confidence: Confidence;
  reasoning: string;
  timeframe: string;
  positionSizeILS: number;
  positionWeightPct: number;
  entryConditions: string[];
  exitConditions: string[];
  catalysts: Array<{ description: string; expiresAt: string | null; triggered: boolean }>;
  actionCatalysts: Array<{ description: string; expiresAt: string | null; triggered: boolean }>;
  avoidConditions: string[];
  hasExpiredCatalysts: boolean;
  lastDeepDiveAt: string | null;
  updatedAt: string;
  version: number;
  stance: string | null;
  potentialScore: number | null;
  urgencyScore: number | null;
  urgencyLabel: string | null;
  portfolioFitScore: number | null;
  suggestedAllocationPct: number | null;
  suggestedAllocationILS: number | null;
  nextReviewAt: string | null;
}

async function loadTrackedAssetStatusByTicker(userId: string): Promise<Map<string, TrackedAssetStatus>> {
  try {
    const trackedAssets = await listTrackedAssets(userId);
    return new Map(trackedAssets.map((asset) => [asset.ticker, asset.status]));
  } catch (error) {
    logger.warn(
      `Failed to load tracked assets for strategies route; falling back to legacy classification: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return new Map();
  }
}

/**
 * Build a StrategyListRow from a DB record. Used when the DB is the source
 * of truth (Phase 2 reader cutover).
 */
function rowFromDbRecord(
  record: StrategyRecord,
  inPortfolio: boolean,
  trackedStatusByTicker: Map<string, TrackedAssetStatus>
): StrategyListRow {
  const now = new Date();
  const scope: StrategyScope = inPortfolio ? "portfolio" : "tracking";
  const trackingStatus = trackedStatusByTicker.get(record.ticker) ?? record.trackingStatus ?? null;
  const hasExpiredCatalysts = record.catalysts.some(
    (c) => c.expiresAt !== null && new Date(c.expiresAt) < now
  );
  return {
    ticker: record.ticker,
    inPortfolio,
    scope,
    trackingStatus: scope === "tracking" ? (trackingStatus as TrackedAssetStatus | null) ?? "active" : null,
    verdict: record.verdict as Verdict,
    confidence: record.confidence as Confidence,
    reasoning: record.reasoning.length > 150 ? record.reasoning.slice(0, 150) + "…" : record.reasoning,
    timeframe: record.timeframe,
    positionSizeILS: record.positionSizeIls,
    positionWeightPct: record.positionWeightPct,
    entryConditions: record.entryConditions,
    exitConditions: record.exitConditions,
    catalysts: record.catalysts,
    actionCatalysts: record.actionCatalysts,
    avoidConditions: record.avoidConditions,
    hasExpiredCatalysts,
    lastDeepDiveAt: record.lastDeepDiveAt,
    updatedAt: record.updatedAt,
    version: record.version,
    stance: record.stance,
    potentialScore: record.potentialScore,
    urgencyScore: record.urgencyScore,
    urgencyLabel: record.urgencyLabel,
    portfolioFitScore: record.portfolioFitScore,
    suggestedAllocationPct: record.suggestedAllocationPct,
    suggestedAllocationILS: record.suggestedAllocationIls,
    nextReviewAt: record.nextReviewAt,
  };
}

// ── GET /api/strategies ────────────────────────────────────────────────────

router.get(
  "/strategies",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;

    const portfolioTickers = new Set<string>();
    try {
      const rawPortfolio = await fs.readFile(ws.portfolioFile, "utf-8");
      const parsedPortfolio = PortfolioFileSchema.safeParse(JSON.parse(rawPortfolio));
      if (parsedPortfolio.success) {
        for (const positions of Object.values(parsedPortfolio.data.accounts)) {
          for (const position of positions) {
            portfolioTickers.add(position.ticker);
          }
        }
      }
    } catch {
      // keep empty portfolio set
    }

    const trackedStatusByTicker = await loadTrackedAssetStatusByTicker(ws.userId);
    const strategies: StrategyListRow[] = [];
    const now = new Date();

    // DB-first path (Phase 2 reader cutover)
    if (isApplicationDatabaseConfigured()) {
      try {
        const dbRecords = await listStrategies(ws.userId);
        if (dbRecords.length > 0) {
          for (const record of dbRecords) {
            strategies.push(rowFromDbRecord(record, portfolioTickers.has(record.ticker), trackedStatusByTicker));
          }
          strategies.sort((a, b) => {
            const ao = VERDICT_SORT_ORDER[a.verdict] ?? 99;
            const bo = VERDICT_SORT_ORDER[b.verdict] ?? 99;
            if (ao !== bo) return ao - bo;
            return a.ticker.localeCompare(b.ticker);
          });
          res.json({ updatedAt: new Date().toISOString(), strategies });
          return;
        }
      } catch (err) {
        logger.warn(`strategies route: DB read failed, falling back to JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // JSON fallback path (Phase 1 and rollback)
    let tickerDirs: string[] = [];
    try {
      const entries = await fs.readdir(ws.tickersDir, { withFileTypes: true });
      tickerDirs = entries
        .filter((e) => e.isDirectory() && TICKER_REGEX.test(e.name))
        .map((e) => e.name);
    } catch {
      res.json({ updatedAt: new Date().toISOString(), strategies: [] });
      return;
    }

    for (const ticker of tickerDirs) {
      const strategyPath = ws.strategyFile(ticker);
      const loaded = await loadStrategyFile(strategyPath, { repair: true, tickerHint: ticker });
      if (!loaded.valid || !loaded.strategy) continue;

      const s = loaded.strategy;
      const inPortfolio = portfolioTickers.has(ticker);
      const trackingStatus = trackedStatusByTicker.get(ticker) ?? s.trackingStatus ?? null;
      const scope: StrategyScope = inPortfolio ? "portfolio" : "tracking";
      const hasExpiredCatalysts = (s.catalysts ?? []).some(
        (c) => c.expiresAt !== null && new Date(c.expiresAt) < now
      );

      strategies.push({
        ticker,
        inPortfolio,
        scope,
        trackingStatus: scope === "tracking" ? trackingStatus ?? "active" : null,
        verdict: s.verdict as Verdict,
        confidence: s.confidence as Confidence,
        reasoning: s.reasoning.length > 150 ? s.reasoning.slice(0, 150) + "…" : s.reasoning,
        timeframe: s.timeframe,
        positionSizeILS: s.positionSizeILS ?? 0,
        positionWeightPct: s.positionWeightPct ?? 0,
        entryConditions: s.entryConditions ?? [],
        exitConditions: s.exitConditions ?? [],
        catalysts: s.catalysts ?? [],
        actionCatalysts: s.actionCatalysts ?? [],
        avoidConditions: s.avoidConditions ?? [],
        hasExpiredCatalysts,
        lastDeepDiveAt: s.lastDeepDiveAt ?? null,
        updatedAt: s.updatedAt,
        version: s.version ?? 1,
        stance: s.stance ?? null,
        potentialScore: s.potentialScore ?? null,
        urgencyScore: s.urgencyScore ?? null,
        urgencyLabel: s.urgencyLabel ?? null,
        portfolioFitScore: s.portfolioFitScore ?? null,
        suggestedAllocationPct: s.suggestedAllocationPct ?? null,
        suggestedAllocationILS: s.suggestedAllocationILS ?? null,
        nextReviewAt: s.nextReviewAt ?? null,
      });
    }

    strategies.sort((a, b) => {
      const ao = VERDICT_SORT_ORDER[a.verdict] ?? 99;
      const bo = VERDICT_SORT_ORDER[b.verdict] ?? 99;
      if (ao !== bo) return ao - bo;
      return a.ticker.localeCompare(b.ticker);
    });

    res.json({ updatedAt: new Date().toISOString(), strategies });
  })
);

// ── GET /api/strategies/:ticker ───────────────────────────────────────────

router.get(
  "/strategies/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ticker = String(req.params["ticker"] ?? "").toUpperCase();

    if (!TICKER_REGEX.test(ticker)) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }

    const strategyPath = ws.strategyFile(ticker);

    // DB-first path
    if (isApplicationDatabaseConfigured()) {
      try {
        const record = await readStrategy(ws.userId, ticker);
        if (record) {
          res.json(record);
          return;
        }
      } catch (err) {
        logger.warn(`strategies/:ticker DB read failed, falling back to JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // JSON fallback
    const loaded = await loadStrategyFile(strategyPath, { repair: true, tickerHint: ticker });
    if (!loaded.valid || !loaded.strategy) {
      if ((loaded.errors ?? []).some((error) => error.startsWith("File not found:"))) {
        res.status(404).json({ error: "Strategy not found" });
        return;
      }
      res.status(400).json({ error: "Invalid strategy schema", details: loaded.errors });
      return;
    }

    res.json(loaded.strategy);
  })
);

export default router;
