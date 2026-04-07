import { Router, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { getUsdIlsRate, getPricesParallel } from "../services/priceService.js";

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
    const raw = await fs.readFile(ws.portfolioFile, "utf-8");
    const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));

    const usdIlsRate = await getUsdIlsRate();

    const allPositions = [
      ...portfolio.accounts["main"].map((p) => ({ ...p, account: "main" })),
      ...(portfolio.accounts["second"] ?? []).map((p) => ({
        ...p,
        account: "second",
      })),
    ];

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

export default router;
