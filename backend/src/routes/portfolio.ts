import { Router, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Exchange } from "../types/index.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { getUsdIlsRate, getPricesParallel, getPriceHistory } from "../services/priceService.js";

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

interface PortfolioResponse {
  updatedAt: string;
  usdIlsRate: number;
  totalILS: number;
  totalCostILS: number;
  totalPlILS: number;
  totalPlPct: number;
  positions: PositionRow[];
}

interface PositionRow {
  ticker: string;
  exchange: string;
  shares: number;
  accounts: string[];
  avgPriceILS: number;
  livePriceILS: number;
  currentILS: number;
  costILS: number;
  plILS: number;
  plPct: number;
  weightPct: number;
  priceStale: boolean;
}

router.get(
  "/portfolio",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    let raw: string;
    try {
      raw = await fs.readFile(ws.portfolioFile, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // No portfolio yet — return empty state
        res.json({
          updatedAt: new Date().toISOString(),
          usdIlsRate: 0,
          totalILS: 0,
          totalCostILS: 0,
          totalPlILS: 0,
          totalPlPct: 0,
          positions: [],
        });
        return;
      }
      throw err;
    }
    const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));

    const usdIlsRate = await getUsdIlsRate();

    // Flatten all positions with their account name
    const allPositions: Array<{ ticker: string; exchange: Exchange; shares: number; unitAvgBuyPrice: number; unitCurrency: "USD" | "ILA" | "GBP" | "EUR"; account: string }> = [];
    for (const [accountName, positions] of Object.entries(portfolio.accounts)) {
      for (const pos of positions) {
        allPositions.push({ ...pos, account: accountName });
      }
    }

    const uniqueTickers = Array.from(new Set(allPositions.map((p) => p.ticker))).map(
      (ticker) => {
        const first = allPositions.find((p) => p.ticker === ticker)!;
        return { ticker, exchange: first.exchange };
      }
    );

    const prices = await getPricesParallel(uniqueTickers, usdIlsRate);

    const tickerMap = new Map<
      string,
      {
        exchange: string;
        totalShares: number;
        avgPriceILS: number;
        costILS: number;
        accounts: string[];
        livePriceILS: number;
        priceStale: boolean;
      }
    >();

    for (const pos of allPositions) {
      const price = prices.get(pos.ticker);
      const liveILS = price?.priceILS ?? 0;

      const avgILS =
        pos.exchange === "TASE"
          ? pos.unitAvgBuyPrice
          : pos.unitAvgBuyPrice * usdIlsRate;
      const costILS = avgILS * pos.shares;

      const existing = tickerMap.get(pos.ticker);
      if (existing) {
        existing.totalShares += pos.shares;
        existing.costILS += costILS;
        existing.accounts.push(pos.account);
      } else {
        tickerMap.set(pos.ticker, {
          exchange: pos.exchange,
          totalShares: pos.shares,
          avgPriceILS: avgILS,
          costILS,
          accounts: [pos.account],
          livePriceILS: liveILS,
          priceStale: price?.stale ?? true,
        });
      }
    }

    const positions: PositionRow[] = [];
    let totalILS = 0;
    let totalCostILS = 0;

    for (const [ticker, data] of tickerMap) {
      const currentILS = data.livePriceILS * data.totalShares;
      const plILS = currentILS - data.costILS;
      const plPct = data.costILS > 0 ? (plILS / data.costILS) * 100 : 0;

      totalILS += currentILS;
      totalCostILS += data.costILS;

      positions.push({
        ticker,
        exchange: data.exchange,
        shares: data.totalShares,
        accounts: data.accounts,
        avgPriceILS: Math.round(data.avgPriceILS * 100) / 100,
        livePriceILS: Math.round(data.livePriceILS * 100) / 100,
        currentILS: Math.round(currentILS * 100) / 100,
        costILS: Math.round(data.costILS * 100) / 100,
        plILS: Math.round(plILS * 100) / 100,
        plPct: Math.round(plPct * 100) / 100,
        weightPct: 0,
        priceStale: data.priceStale,
      });
    }

    const totalPlILS = totalILS - totalCostILS;
    const totalPlPct = totalCostILS > 0 ? (totalPlILS / totalCostILS) * 100 : 0;

    for (const pos of positions) {
      pos.weightPct = Math.round((pos.currentILS / totalILS) * 10000) / 100;
    }

    positions.sort((a, b) => b.currentILS - a.currentILS);

    const response: PortfolioResponse = {
      updatedAt: new Date().toISOString(),
      usdIlsRate,
      totalILS: Math.round(totalILS * 100) / 100,
      totalCostILS: Math.round(totalCostILS * 100) / 100,
      totalPlILS: Math.round(totalPlILS * 100) / 100,
      totalPlPct: Math.round(totalPlPct * 100) / 100,
      positions,
    };

    res.json(response);
  })
);

// PATCH /portfolio/position/:ticker - Update a position's shares or avg price
router.patch(
  "/position/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const tickerParam = req.params.ticker as string;
    const { shares, avgPriceILS } = req.body as { shares?: number; avgPriceILS?: number };

    if (!tickerParam) {
      res.status(400).json({ error: "ticker required" });
      return;
    }

    let raw: string;
    try {
      raw = await fs.readFile(ws.portfolioFile, "utf-8");
    } catch {
      res.status(404).json({ error: "portfolio not found" });
      return;
    }

    const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));

    // Find the position across all accounts
    let found = false;
    for (const [_accountName, positions] of Object.entries(portfolio.accounts)) {
      const pos = positions.find((p) => p.ticker === tickerParam.toUpperCase());
      if (pos) {
        if (shares !== undefined) pos.shares = shares;
        if (avgPriceILS !== undefined) {
          // Convert from ILS back to the original currency if needed
          if (pos.exchange === "TASE") {
            pos.unitAvgBuyPrice = avgPriceILS;
          } else {
            // For non-ILA exchanges, store in USD equivalent
            const usdIlsRate = await getUsdIlsRate();
            pos.unitAvgBuyPrice = avgPriceILS / usdIlsRate;
          }
        }
        found = true;
        break;
      }
    }

    if (!found) {
      res.status(404).json({ error: "position not found" });
      return;
    }

    await fs.writeFile(ws.portfolioFile, JSON.stringify(portfolio, null, 2), "utf-8");
    res.json({ success: true });
  })
);

// GET /portfolio/history/:ticker - Get price history for charting
router.get(
  "/history/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ticker = req.params.ticker as string;
    const timeframe = (req.query.timeframe as string) || "1M";

    if (!ticker) {
      res.status(400).json({ error: "ticker required" });
      return;
    }

    try {
      const history = await getPriceHistory(ticker.toUpperCase(), timeframe);
      res.json(history);
    } catch (err) {
      console.error("Price history error:", err);
      res.status(500).json({ error: "failed to fetch price history" });
    }
  })
);

export default router;
