import { Router, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Verdict, Confidence } from "../types/index.js";
import { loadStrategyFile } from "../services/strategyFileService.js";

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

interface VerdictRow {
  ticker: string;
  verdict: Verdict;
  confidence: Confidence;
  timeframe: string;
  reasoning: string;
  positionSizeILS: number;
  positionWeightPct: number;
  entryConditions: string[];
  exitConditions: string[];
  catalysts: Array<{
    description: string;
    expiresAt: string | null;
    triggered: boolean;
  }>;
  lastDeepDiveAt: string | null;
  updatedAt: string;
  hasExpiredCatalysts: boolean;
}

interface VerdictResponse {
  updatedAt: string;
  verdicts: VerdictRow[];
}

router.get(
  "/verdicts",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;

    let tickerDirs: string[] = [];
    try {
      tickerDirs = await fs.readdir(ws.tickersDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // tickers dir doesn't exist yet — return empty verdicts
        res.json({ updatedAt: new Date().toISOString(), verdicts: [] });
        return;
      }
      throw err;
    }

    const verdicts: VerdictRow[] = [];
    const now = new Date();

    for (const ticker of tickerDirs) {
      const strategyPath = ws.strategyFile(ticker);
      const loaded = await loadStrategyFile(strategyPath, { repair: true, tickerHint: ticker });
      if (!loaded.valid || !loaded.strategy) {
        continue;
      }

      const s = loaded.strategy;

      const hasExpiredCatalysts = (s.catalysts ?? []).some(
        (c) => c.expiresAt !== null && new Date(c.expiresAt) < now
      );

      verdicts.push({
        ticker: s.ticker,
        verdict: s.verdict as Verdict,
        confidence: s.confidence as Confidence,
        timeframe: s.timeframe,
        reasoning:
          s.reasoning.length > 150
            ? s.reasoning.slice(0, 150) + "…"
            : s.reasoning,
        positionSizeILS: s.positionSizeILS,
        positionWeightPct: s.positionWeightPct,
        entryConditions: s.entryConditions ?? [],
        exitConditions: s.exitConditions ?? [],
        catalysts: s.catalysts ?? [],
        lastDeepDiveAt: s.lastDeepDiveAt ?? null,
        updatedAt: s.updatedAt,
        hasExpiredCatalysts,
      });
    }

    const response: VerdictResponse = {
      updatedAt: new Date().toISOString(),
      verdicts,
    };

    res.json(response);
  })
);

export default router;
