import { Router, type Request, type Response, type NextFunction } from "express";
import { searchInstruments, type InstrumentSearchResult } from "../services/searchService.js";

const router = Router();

const CACHE_TTL = 30_000;
const searchCache = new Map<string, { results: InstrumentSearchResult[]; error: string | null; ts: number }>();

router.get(
  "/search/ticker",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = String(req.query["q"] ?? "").trim().toUpperCase();
      if (q.length < 2) {
        res.json({ results: [] });
        return;
      }

      const cached = searchCache.get(q);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        res.json({ results: cached.results, error: cached.error });
        return;
      }

      const { results, error } = await searchInstruments(q);

      searchCache.set(q, { results, error, ts: Date.now() });
      res.json({ results, error });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
