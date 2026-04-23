import { Router, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { StrategySchema } from "../schemas/strategy.js";
import type { Verdict, Confidence } from "../types/index.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";

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

// ── GET /api/strategies ────────────────────────────────────────────────────

router.get(
  "/strategies",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;

    let tickerDirs: string[] = [];
    try {
      tickerDirs = await fs.readdir(ws.tickersDir);
    } catch {
      res.json({ updatedAt: new Date().toISOString(), strategies: [] });
      return;
    }

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

    const strategies: Array<{
      ticker: string;
      inPortfolio: boolean;
      verdict: Verdict;
      confidence: Confidence;
      reasoning: string;
      timeframe: string;
      positionSizeILS: number;
      positionWeightPct: number;
      entryConditions: string[];
      exitConditions: string[];
      catalysts: Array<{ description: string; expiresAt: string | null; triggered: boolean }>;
      hasExpiredCatalysts: boolean;
      lastDeepDiveAt: string | null;
      updatedAt: string;
      version: number;
    }> = [];

    const now = new Date();

    for (const ticker of tickerDirs) {
      const strategyPath = ws.strategyFile(ticker);
      let raw: string;
      try {
        raw = await fs.readFile(strategyPath, "utf-8");
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const result = StrategySchema.safeParse(parsed);
      if (!result.success) continue;

      const s = result.data;
      const hasExpiredCatalysts = (s.catalysts ?? []).some(
        (c) => c.expiresAt !== null && new Date(c.expiresAt) < now
      );

      strategies.push({
        ticker,
        inPortfolio: portfolioTickers.has(ticker),
        verdict: s.verdict as Verdict,
        confidence: s.confidence as Confidence,
        reasoning:
          s.reasoning.length > 150 ? s.reasoning.slice(0, 150) + "…" : s.reasoning,
        timeframe: s.timeframe,
        positionSizeILS: s.positionSizeILS ?? 0,
        positionWeightPct: s.positionWeightPct ?? 0,
        entryConditions: s.entryConditions ?? [],
        exitConditions: s.exitConditions ?? [],
        catalysts: s.catalysts ?? [],
        hasExpiredCatalysts,
        lastDeepDiveAt: s.lastDeepDiveAt ?? null,
        updatedAt: s.updatedAt,
        version: s.version ?? 1,
      });
    }

    // Sort: SELL/CLOSE first, REDUCE second, then by verdict order, then alphabetical
    strategies.sort((a, b) => {
      const ao = VERDICT_SORT_ORDER[a.verdict] ?? 99;
      const bo = VERDICT_SORT_ORDER[b.verdict] ?? 99;
      if (ao !== bo) return ao - bo;
      return a.ticker.localeCompare(b.ticker);
    });

    res.json({
      updatedAt: new Date().toISOString(),
      strategies,
    });
  })
);

// ── GET /api/strategies/:ticker ───────────────────────────────────────────

router.get(
  "/strategies/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ticker = String(req.params["ticker"] ?? "").toUpperCase();

    if (!/^[A-Z0-9]{1,10}$/.test(ticker)) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }

    const strategyPath = ws.strategyFile(ticker);

    let raw: string;
    try {
      raw = await fs.readFile(strategyPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "Strategy not found" });
        return;
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "Invalid JSON in strategy file" });
      return;
    }

    const result = StrategySchema.safeParse(parsed);
    if (!result.success) {
      res.status(400).json({ error: "Invalid strategy schema", details: result.error.errors });
      return;
    }

    res.json(result.data);
  })
);

export default router;
