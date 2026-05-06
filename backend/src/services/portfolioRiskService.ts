import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import { insertPortfolioRiskSnapshot } from "./portfolioRiskStore.js";
import { getUsdIlsRate } from "./priceService.js";
import { PortfolioFileSchema } from "../schemas/portfolio.js";
import { promises as fs } from "fs";
import { resolveConfiguredPath } from "./paths.js";
import path from "path";
import { logger } from "./logger.js";

/**
 * Portfolio-level risk computation — Phase 7, task 7.8.
 *
 * Spec: design.md §14; L3.1–L3.3.
 *
 * Computes concentration metrics across the whole portfolio and persists a
 * `portfolio_risk_snapshots` row. Called from:
 *   - daily-brief admission
 *   - full-report admission
 *   - position_transactions insert path
 */

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

export interface ConcentrationEntry {
  key: string;
  pct: number;
}

export interface PortfolioRiskResult {
  totalValueIls: number;
  concentrationBySingleNamePct: ConcentrationEntry[];
  concentrationBySectorPct: ConcentrationEntry[];
  concentrationByCurrencyPct: ConcentrationEntry[];
  concentrationByAssetClassPct: ConcentrationEntry[];
  largestSinglePositionTicker: string | null;
  largestSinglePositionPct: number | null;
}

function topN(entries: ConcentrationEntry[], n = 10): ConcentrationEntry[] {
  return entries.sort((a, b) => b.pct - a.pct).slice(0, n);
}

export async function computeAndStorePortfolioRisk(userId: string): Promise<void> {
  if (!isApplicationDatabaseConfigured()) return;

  try {
    const portfolioPath = path.join(USERS_DIR, userId, "data", "portfolio.json");
    const raw = await fs.readFile(portfolioPath, "utf-8");
    const portfolio = PortfolioFileSchema.safeParse(JSON.parse(raw));
    if (!portfolio.success) return;

    const usdIlsRate = await getUsdIlsRate();
    const allPositions = Object.entries(portfolio.data.accounts).flatMap(([account, positions]) =>
      positions.map((p) => ({ account, ...p }))
    );

    // Compute ILS value per position using cost basis (live prices would be better
    // but require an async fetch per position; cost basis is a reasonable proxy for
    // concentration metrics and avoids N price fetches on every transaction write).
    const positionValues = allPositions.map((p) => {
      const valueIls = p.exchange === "TASE"
        ? p.unitAvgBuyPrice * p.shares
        : p.unitAvgBuyPrice * usdIlsRate * p.shares;
      return { ticker: p.ticker, exchange: p.exchange, unitCurrency: p.unitCurrency, valueIls };
    });

    const totalValueIls = positionValues.reduce((sum, p) => sum + p.valueIls, 0);
    if (totalValueIls <= 0) return;

    // Concentration by single name
    const byName = new Map<string, number>();
    for (const p of positionValues) {
      byName.set(p.ticker, (byName.get(p.ticker) ?? 0) + p.valueIls);
    }
    const concentrationBySingleNamePct: ConcentrationEntry[] = topN(
      Array.from(byName.entries()).map(([key, val]) => ({ key, pct: Math.round((val / totalValueIls) * 10000) / 100 }))
    );

    // Concentration by currency
    const byCurrency = new Map<string, number>();
    for (const p of positionValues) {
      const ccy = p.exchange === "TASE" ? "ILS" : "USD";
      byCurrency.set(ccy, (byCurrency.get(ccy) ?? 0) + p.valueIls);
    }
    const concentrationByCurrencyPct: ConcentrationEntry[] = topN(
      Array.from(byCurrency.entries()).map(([key, val]) => ({ key, pct: Math.round((val / totalValueIls) * 10000) / 100 }))
    );

    // Asset class from strategies table (best-effort; defaults to "equity")
    const ds = await getApplicationDataSource();
    const strategyRows = (await ds.query(
      `SELECT ticker, asset_class FROM strategies WHERE user_id = $1`,
      [userId]
    )) as Array<{ ticker: string; asset_class: string }>;
    const assetClassByTicker = new Map(strategyRows.map((r) => [r.ticker, r.asset_class]));

    const byAssetClass = new Map<string, number>();
    for (const p of positionValues) {
      const ac = assetClassByTicker.get(p.ticker) ?? "equity";
      byAssetClass.set(ac, (byAssetClass.get(ac) ?? 0) + p.valueIls);
    }
    const concentrationByAssetClassPct: ConcentrationEntry[] = topN(
      Array.from(byAssetClass.entries()).map(([key, val]) => ({ key, pct: Math.round((val / totalValueIls) * 10000) / 100 }))
    );

    // Sector — not available without a sector data source; placeholder
    const concentrationBySectorPct: ConcentrationEntry[] = [{ key: "unknown", pct: 100 }];

    // Largest single position
    const largest = concentrationBySingleNamePct[0] ?? null;

    await insertPortfolioRiskSnapshot({
      userId,
      totalValueIls: Math.round(totalValueIls * 100) / 100,
      concentrationBySingleNamePct,
      concentrationBySectorPct,
      concentrationByCurrencyPct,
      concentrationByAssetClassPct,
      largestSinglePositionTicker: largest?.key ?? null,
      largestSinglePositionPct: largest?.pct ?? null,
    });
  } catch (err) {
    logger.warn(`portfolioRiskService: failed to compute risk for ${userId}: ${(err as Error).message}`);
  }
}
