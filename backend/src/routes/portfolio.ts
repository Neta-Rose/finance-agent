import { Router, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { Exchange } from "../types/index.js";
import { PortfolioFileSchema, PortfolioPositionSchema } from "../schemas/portfolio.js";
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
  accounts: string[];
  positions: PositionRow[];
}

interface PositionRow {
  ticker: string;
  exchange: string;
  shares: number;
  accounts: string[];
  accountBreakdown: Array<{
    account: string;
    shares: number;
    avgPriceILS: number;
  }>;
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
          accounts: [],
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
        weightedAvgPriceIlsSum: number;
        costILS: number;
        accounts: string[];
        accountBreakdown: Array<{
          account: string;
          shares: number;
          avgPriceILS: number;
        }>;
        livePriceILS: number;
        priceStale: boolean;
      }
    >();

    for (const pos of allPositions) {
      const price = prices.get(pos.ticker);
      const liveILS = price?.priceILS ?? 0;

      const avgILS =
        pos.exchange === "TASE"
          ? pos.unitCurrency === "ILA"
            ? pos.unitAvgBuyPrice / 100
            : pos.unitAvgBuyPrice
          : pos.unitAvgBuyPrice * usdIlsRate;
      const costILS = avgILS * pos.shares;

      const existing = tickerMap.get(pos.ticker);
      if (existing) {
        existing.totalShares += pos.shares;
        existing.weightedAvgPriceIlsSum += avgILS * pos.shares;
        existing.costILS += costILS;
        existing.accounts.push(pos.account);
        existing.accountBreakdown.push({
          account: pos.account,
          shares: pos.shares,
          avgPriceILS: Math.round(avgILS * 100) / 100,
        });
      } else {
        tickerMap.set(pos.ticker, {
          exchange: pos.exchange,
          totalShares: pos.shares,
          weightedAvgPriceIlsSum: avgILS * pos.shares,
          costILS,
          accounts: [pos.account],
          accountBreakdown: [{
            account: pos.account,
            shares: pos.shares,
            avgPriceILS: Math.round(avgILS * 100) / 100,
          }],
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
        accountBreakdown: data.accountBreakdown,
        avgPriceILS: Math.round((data.weightedAvgPriceIlsSum / data.totalShares) * 100) / 100,
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
      accounts: Object.keys(portfolio.accounts),
      positions,
    };

    res.json(response);
  })
);

const updatePositionHandler = handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const tickerParam = req.params.ticker as string;
    const { shares, avgPriceILS, account } = req.body as {
      shares?: number;
      avgPriceILS?: number;
      account?: string;
    };

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

    const normalizedTicker = tickerParam.toUpperCase();
    const matches: Array<{ accountName: string; index: number }> = [];
    for (const [accountName, positions] of Object.entries(portfolio.accounts)) {
      const index = positions.findIndex((p) => p.ticker === normalizedTicker);
      if (index !== -1) matches.push({ accountName, index });
    }

    if (matches.length === 0) {
      res.status(404).json({ error: "position not found" });
      return;
    }

    if (!account && matches.length > 1) {
      res.status(409).json({
        error: "multiple_positions_found",
        ticker: normalizedTicker,
        accounts: matches.map((match) => match.accountName),
      });
      return;
    }

    const targetMatch = account
      ? matches.find((match) => match.accountName === account)
      : matches[0];

    if (!targetMatch) {
      res.status(404).json({ error: "position not found for account" });
      return;
    }

    const pos = portfolio.accounts[targetMatch.accountName]?.[targetMatch.index];
    if (!pos) {
      res.status(404).json({ error: "position not found" });
      return;
    }

    if (shares !== undefined) pos.shares = shares;
    if (avgPriceILS !== undefined) {
      if (pos.exchange === "TASE") {
        pos.unitAvgBuyPrice = pos.unitCurrency === "ILA"
          ? avgPriceILS * 100
          : avgPriceILS;
      } else {
        const usdIlsRate = await getUsdIlsRate();
        pos.unitAvgBuyPrice = avgPriceILS / usdIlsRate;
      }
    }

    await fs.writeFile(ws.portfolioFile, JSON.stringify(portfolio, null, 2), "utf-8");
    res.json({ success: true });
  });

// PATCH /portfolio/position/:ticker - Update a position's shares or avg price
// Keep both route shapes live for compatibility with older clients.
router.patch("/position/:ticker", updatePositionHandler);
router.patch("/portfolio/position/:ticker", updatePositionHandler);

// POST /portfolio/position — add a new position
router.post(
  "/portfolio/position",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const { ticker, exchange, shares, unitAvgBuyPrice, unitCurrency, account, force } =
      req.body as {
        ticker?: string;
        exchange?: string;
        shares?: number;
        unitAvgBuyPrice?: number;
        unitCurrency?: string;
        account?: string;
        force?: boolean;
      };

    let raw: string;
    try {
      raw = await fs.readFile(ws.portfolioFile, "utf-8");
    } catch {
      res.status(404).json({ error: "portfolio not found" });
      return;
    }

    const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));

    if (!account || !portfolio.accounts[account]) {
      res.status(400).json({ error: "account_not_found" });
      return;
    }

    // Clash check — bypassed with force:true
    if (!force) {
      const clashAccounts: string[] = [];
      for (const [accName, positions] of Object.entries(portfolio.accounts)) {
        if (positions.some((p) => p.ticker === String(ticker ?? "").toUpperCase())) {
          clashAccounts.push(accName);
        }
      }
      if (clashAccounts.length > 0) {
        res.status(409).json({ clash: true, existingAccounts: clashAccounts });
        return;
      }
    }

    const newPos = PortfolioPositionSchema.parse({
      ticker: String(ticker ?? "").toUpperCase(),
      exchange,
      shares,
      unitAvgBuyPrice,
      unitCurrency,
    });

    portfolio.accounts[account].push(newPos);
    await fs.writeFile(ws.portfolioFile, JSON.stringify(portfolio, null, 2), "utf-8");
    res.status(201).json({ success: true });
  })
);

// DELETE /portfolio/position/:ticker?account=name — remove a position from a specific account
router.delete(
  "/portfolio/position/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ticker = String(req.params.ticker ?? "").toUpperCase();
    const account = String(req.query.account ?? "");

    if (!ticker) {
      res.status(400).json({ error: "ticker required" });
      return;
    }
    if (!account) {
      res.status(400).json({ error: "account required" });
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
    const positions = portfolio.accounts[account];
    if (!positions) {
      res.status(404).json({ error: "account_not_found" });
      return;
    }

    const nextPositions = positions.filter((position) => position.ticker !== ticker);
    if (nextPositions.length === positions.length) {
      res.status(404).json({ error: "position not found" });
      return;
    }

    portfolio.accounts[account] = nextPositions;
    await fs.writeFile(ws.portfolioFile, JSON.stringify(portfolio, null, 2), "utf-8");
    res.json({ success: true });
  })
);

// POST /portfolio/accounts — add an empty account
router.post(
  "/portfolio/accounts",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const name = String((req.body as { name?: string }).name ?? "").trim();

    if (!/^[a-zA-Z0-9 _-]{1,30}$/.test(name)) {
      res.status(400).json({ error: "invalid_account_name" });
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
    if (portfolio.accounts[name]) {
      res.status(409).json({ error: "account_exists" });
      return;
    }

    portfolio.accounts[name] = [];
    await fs.writeFile(ws.portfolioFile, JSON.stringify(portfolio, null, 2), "utf-8");
    res.status(201).json({ success: true, account: name });
  })
);

// DELETE /portfolio/accounts/:name — remove an empty account only
router.delete(
  "/portfolio/accounts/:name",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const name = String(req.params.name ?? "");

    if (!name) {
      res.status(400).json({ error: "account name required" });
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
    const account = portfolio.accounts[name];
    if (!account) {
      res.status(404).json({ error: "account_not_found" });
      return;
    }
    if (account.length > 0) {
      res.status(409).json({ error: "account_not_empty" });
      return;
    }

    delete portfolio.accounts[name];
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
