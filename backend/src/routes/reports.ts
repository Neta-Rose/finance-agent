import { Router, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import { StrategySchema } from "../schemas/strategy.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { guardPath } from "../middleware/userIsolation.js";
import { readFeedPage, type StoredBatch } from "../services/feedService.js";

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
  "quick_check",
];

const BATCH_ID_REGEX = /^[a-zA-Z0-9_]{1,60}$/;
const TICKER_REGEX = /^[A-Z0-9]{1,10}$/;

async function readCurrentMeta(ws: UserWorkspace): Promise<{
  totalBatches: number;
  totalPages: number;
  lastUpdated: string | null;
  newestBatchId: string | null;
}> {
  try {
    const raw = await fs.readFile(path.join(ws.reportsDir, "index", "meta.json"), "utf-8");
    return JSON.parse(raw) as {
      totalBatches: number;
      totalPages: number;
      lastUpdated: string | null;
      newestBatchId: string | null;
    };
  } catch {
    return {
      totalBatches: 0,
      totalPages: 0,
      lastUpdated: null,
      newestBatchId: null,
    };
  }
}

async function readCurrentPage(ws: UserWorkspace, pageNum: number): Promise<{
  page: number;
  totalPages: number;
  batches: StoredBatch[];
} | null> {
  const pagePath = path.join(ws.reportsDir, "index", `page-${String(pageNum).padStart(3, "0")}.json`);
  try {
    const raw = await fs.readFile(pagePath, "utf-8");
    return JSON.parse(raw) as {
      page: number;
      totalPages: number;
      batches: StoredBatch[];
    };
  } catch {
    return null;
  }
}

router.get(
  "/reports/meta",
  handler(async (_req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    res.json(await readCurrentMeta(ws));
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
    
    const page = await readCurrentPage(ws, pageNum);
    if (!page) {
      res.status(404).json({ error: "Page not found" });
      return;
    }

    res.json({
      ...page,
      batches: page.batches.map((batch) => ({
        ...batch,
        tickers: batch.tickers.map((ticker: string) => ({
          ticker,
          verdict: batch.entries?.[ticker]?.verdict ?? "HOLD",
        })),
      })),
    });
  })
);

router.get(
  "/reports/feed/:pageNum",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const pageNum = parseInt(String(req.params["pageNum"] ?? "0"), 10);
    const mode = typeof req.query["mode"] === "string" ? req.query["mode"] : null;
    const search = typeof req.query["q"] === "string" ? req.query["q"].trim() : null;
    if (!Number.isInteger(pageNum) || pageNum < 1) {
      res.status(400).json({ error: "pageNum must be positive integer" });
      return;
    }

    const page = await readFeedPage(
      ws,
      {
        pageNum,
        mode,
        search,
      },
      readCurrentMeta,
      readCurrentPage
    );
    res.json(page);
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

    const filePath = path.join(ws.reportsDir, ticker, `${reportType}.json`);
    guardPath(ws, filePath);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      try {
        res.json({ batchId, ticker, reportType, content: JSON.parse(raw) });
      } catch {
        res.status(422).json({ error: "Report is not valid JSON" });
      }
      return;
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
