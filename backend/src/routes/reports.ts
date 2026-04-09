import { Router, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import { StrategySchema } from "../schemas/strategy.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { guardPath } from "../middleware/userIsolation.js";

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

const VALID_REPORT_TYPES = [
  "fundamentals",
  "technical",
  "sentiment",
  "macro",
  "risk",
  "bull",
  "bear",
  "bull_case",
  "bear_case",
  "strategy",
];

const BATCH_ID_REGEX = /^[a-zA-Z0-9_]{1,60}$/;
const TICKER_REGEX = /^[A-Z0-9]{1,10}$/;

router.get(
  "/reports/meta",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const metaPath = path.join(ws.snapshotsDir, "index", "meta.json");
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      res.json(JSON.parse(raw));
    } catch {
      res.json({
        totalBatches: 0,
        totalPages: 0,
        lastUpdated: null,
        newestBatchId: null,
      });
    }
  })
);

router.get(
  "/reports/page/:pageNum",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const pageNum = parseInt(String(req.params["pageNum"] ?? "0"), 10);
    if (!Number.isInteger(pageNum) || pageNum < 1) {
      res.status(400).json({ error: "pageNum must be positive integer" });
      return;
    }
    const pageFile = path.join(
      ws.snapshotsDir,
      "index",
      `page-${String(pageNum).padStart(3, "0")}.json`
    );
    try {
      const raw = await fs.readFile(pageFile, "utf-8");
      const page = JSON.parse(raw) as {
        page: number;
        totalPages: number;
        batches: Array<{
          batchId: string;
          date: string;
          mode: string;
          tickers: string[];
          entries?: Record<string, { verdict?: string }>;
          [key: string]: unknown;
        }>;
      };
      // Reshape: snapshot stores tickers as string[], frontend expects {ticker, verdict}[]
      const batches = page.batches.map((b) => ({
        ...b,
        tickers: b.tickers.map((ticker) => ({
          ticker,
          verdict: b.entries?.[ticker]?.verdict ?? "HOLD",
        })),
      }));
      res.json({ ...page, batches });
    } catch {
      res.status(404).json({ error: "Page not found" });
    }
  })
);

router.get(
  "/reports/batch/:batchId/:ticker/:reportType",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const batchId = String(req.params["batchId"] ?? "");
    const ticker = String(req.params["ticker"] ?? "");
    const reportType = String(req.params["reportType"] ?? "");

    if (!BATCH_ID_REGEX.test(batchId)) {
      res.status(400).json({ error: "Invalid batchId" });
      return;
    }
    if (!TICKER_REGEX.test(ticker)) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }
    if (!VALID_REPORT_TYPES.includes(reportType)) {
      res
        .status(400)
        .json({
          error: `reportType must be one of: ${VALID_REPORT_TYPES.join(", ")}`,
        });
      return;
    }

    const filePath = path.join(
      ws.snapshotsDir,
      batchId,
      ticker,
      `${reportType}.json`
    );

    guardPath(ws, filePath);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const content = JSON.parse(raw);
      res.json({ batchId, ticker, reportType, content });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      throw err;
    }
  })
);

router.get(
  "/reports/strategy/:ticker",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const ticker = String(req.params["ticker"] ?? "");

    if (!TICKER_REGEX.test(ticker)) {
      res.status(400).json({ error: "Invalid ticker" });
      return;
    }

    const filePath = ws.strategyFile(ticker);
    guardPath(ws, filePath);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const validated = StrategySchema.parse(parsed);
      res.json(validated);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "Strategy not found" });
        return;
      }
      throw err;
    }
  })
);

export default router;
