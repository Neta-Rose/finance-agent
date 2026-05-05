import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type {
  StrategyAssetClass,
  StrategyAssetScope,
  StrategyCatalystJson,
  StrategyConfidence,
  StrategyVerdict,
} from "../db/entities/StrategyEntity.js";

/**
 * Strategy store — Postgres source of truth for the `strategies` table.
 *
 * Spec: design.md §4.2; tasks.md 1.4.
 * Replaces `data/tickers/[T]/strategy.json` as source of truth (A2.1, A2.2).
 * The JSON file is regenerated as a derived export only by `strategyExportService` (A2.3).
 *
 * Concurrency: writeStrategy uses `SELECT … FOR UPDATE` inside an explicit
 * transaction so concurrent synthesis writes serialize per row (A3.1).
 */

export type {
  StrategyAssetClass,
  StrategyAssetScope,
  StrategyConfidence,
  StrategyVerdict,
} from "../db/entities/StrategyEntity.js";

export interface StrategyRecord {
  userId: string;
  ticker: string;
  version: number;
  assetScope: StrategyAssetScope;
  trackingStatus: string | null;
  verdict: StrategyVerdict;
  confidence: StrategyConfidence;
  reasoning: string;
  timeframe: string;
  positionSizeIls: number;
  positionWeightPct: number;
  entryConditions: string[];
  exitConditions: string[];
  catalysts: StrategyCatalystJson[];
  bullCase: string | null;
  bearCase: string | null;
  lastDeepDiveAt: string | null;
  deepDiveTriggeredBy: string | null;
  metadata: Record<string, unknown>;
  stance: string | null;
  potentialScore: number | null;
  urgencyScore: number | null;
  urgencyLabel: string | null;
  portfolioFitScore: number | null;
  suggestedAllocationPct: number | null;
  suggestedAllocationIls: number | null;
  actionCatalysts: StrategyCatalystJson[];
  avoidConditions: string[];
  nextReviewAt: string | null;
  assetClass: StrategyAssetClass;
  createdAt: string;
  updatedAt: string;
}

export interface WriteStrategyInput {
  userId: string;
  ticker: string;
  assetScope?: StrategyAssetScope;
  trackingStatus?: string | null;
  verdict: StrategyVerdict;
  confidence: StrategyConfidence;
  reasoning: string;
  timeframe: string;
  positionSizeIls?: number;
  positionWeightPct?: number;
  entryConditions?: string[];
  exitConditions?: string[];
  catalysts?: StrategyCatalystJson[];
  bullCase?: string | null;
  bearCase?: string | null;
  lastDeepDiveAt?: string | null;
  deepDiveTriggeredBy?: string | null;
  metadata?: Record<string, unknown>;
  stance?: string | null;
  potentialScore?: number | null;
  urgencyScore?: number | null;
  urgencyLabel?: string | null;
  portfolioFitScore?: number | null;
  suggestedAllocationPct?: number | null;
  suggestedAllocationIls?: number | null;
  actionCatalysts?: StrategyCatalystJson[];
  avoidConditions?: string[];
  nextReviewAt?: string | null;
  assetClass?: StrategyAssetClass;
}

interface StrategyRow {
  user_id: string;
  ticker: string;
  version: number;
  asset_scope: StrategyAssetScope;
  tracking_status: string | null;
  verdict: StrategyVerdict;
  confidence: StrategyConfidence;
  reasoning: string;
  timeframe: string;
  position_size_ils: string;
  position_weight_pct: string;
  entry_conditions: string[];
  exit_conditions: string[];
  catalysts: StrategyCatalystJson[];
  bull_case: string | null;
  bear_case: string | null;
  last_deep_dive_at: Date | string | null;
  deep_dive_triggered_by: string | null;
  metadata: Record<string, unknown>;
  stance: string | null;
  potential_score: string | null;
  urgency_score: string | null;
  urgency_label: string | null;
  portfolio_fit_score: string | null;
  suggested_allocation_pct: string | null;
  suggested_allocation_ils: string | null;
  action_catalysts: StrategyCatalystJson[];
  avoid_conditions: string[];
  next_review_at: Date | string | null;
  asset_class: StrategyAssetClass;
  created_at: Date | string;
  updated_at: Date | string;
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toNumberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fromRow(row: StrategyRow): StrategyRecord {
  return {
    userId: row.user_id,
    ticker: row.ticker,
    version: row.version,
    assetScope: row.asset_scope,
    trackingStatus: row.tracking_status,
    verdict: row.verdict,
    confidence: row.confidence,
    reasoning: row.reasoning,
    timeframe: row.timeframe,
    positionSizeIls: Number(row.position_size_ils),
    positionWeightPct: Number(row.position_weight_pct),
    entryConditions: Array.isArray(row.entry_conditions) ? row.entry_conditions : [],
    exitConditions: Array.isArray(row.exit_conditions) ? row.exit_conditions : [],
    catalysts: Array.isArray(row.catalysts) ? row.catalysts : [],
    bullCase: row.bull_case,
    bearCase: row.bear_case,
    lastDeepDiveAt: toIso(row.last_deep_dive_at),
    deepDiveTriggeredBy: row.deep_dive_triggered_by,
    metadata: row.metadata ?? {},
    stance: row.stance,
    potentialScore: toNumberOrNull(row.potential_score),
    urgencyScore: toNumberOrNull(row.urgency_score),
    urgencyLabel: row.urgency_label,
    portfolioFitScore: toNumberOrNull(row.portfolio_fit_score),
    suggestedAllocationPct: toNumberOrNull(row.suggested_allocation_pct),
    suggestedAllocationIls: toNumberOrNull(row.suggested_allocation_ils),
    actionCatalysts: Array.isArray(row.action_catalysts) ? row.action_catalysts : [],
    avoidConditions: Array.isArray(row.avoid_conditions) ? row.avoid_conditions : [],
    nextReviewAt: toIso(row.next_review_at),
    assetClass: row.asset_class,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

const SELECT_COLUMNS = `
  user_id, ticker, version, asset_scope, tracking_status, verdict, confidence,
  reasoning, timeframe, position_size_ils, position_weight_pct,
  entry_conditions, exit_conditions, catalysts, bull_case, bear_case,
  last_deep_dive_at, deep_dive_triggered_by, metadata, stance,
  potential_score, urgency_score, urgency_label, portfolio_fit_score,
  suggested_allocation_pct, suggested_allocation_ils, action_catalysts,
  avoid_conditions, next_review_at, asset_class, created_at, updated_at
`;

export async function readStrategy(userId: string, ticker: string): Promise<StrategyRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM strategies WHERE user_id = $1 AND ticker = $2 LIMIT 1`,
    [userId, normalizeTicker(ticker)]
  )) as StrategyRow[];
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listStrategies(
  userId: string,
  options?: { assetScope?: StrategyAssetScope }
): Promise<StrategyRecord[]> {
  if (!isApplicationDatabaseConfigured()) return [];
  const ds = await getApplicationDataSource();
  const params: unknown[] = [userId];
  let where = `user_id = $1`;
  if (options?.assetScope) {
    params.push(options.assetScope);
    where += ` AND asset_scope = $${params.length}`;
  }
  const rows = (await ds.query(
    `SELECT ${SELECT_COLUMNS} FROM strategies WHERE ${where} ORDER BY updated_at DESC`,
    params
  )) as StrategyRow[];
  return rows.map(fromRow);
}

export interface WriteStrategyResult {
  record: StrategyRecord;
  /** True when this write inserted a new row; false on update. */
  created: boolean;
  /** Previous version number; equals `record.version - 1` on update, 0 on insert. */
  previousVersion: number;
}

export async function writeStrategy(input: WriteStrategyInput): Promise<WriteStrategyResult> {
  if (!isApplicationDatabaseConfigured()) {
    throw new Error("writeStrategy requires the application database");
  }
  const ds = await getApplicationDataSource();
  const ticker = normalizeTicker(input.ticker);

  return ds.transaction(async (manager) => {
    const existingRows = (await manager.query(
      `SELECT version FROM strategies WHERE user_id = $1 AND ticker = $2 FOR UPDATE`,
      [input.userId, ticker]
    )) as Array<{ version: number }>;
    const previousVersion = existingRows[0]?.version ?? 0;
    const created = previousVersion === 0;
    const nextVersion = previousVersion + 1;

    const params: unknown[] = [
      input.userId,
      ticker,
      nextVersion,
      input.assetScope ?? "portfolio",
      input.trackingStatus ?? null,
      input.verdict,
      input.confidence,
      input.reasoning.slice(0, 800),
      input.timeframe,
      input.positionSizeIls ?? 0,
      input.positionWeightPct ?? 0,
      JSON.stringify(input.entryConditions ?? []),
      JSON.stringify(input.exitConditions ?? []),
      JSON.stringify(input.catalysts ?? []),
      input.bullCase ?? null,
      input.bearCase ?? null,
      input.lastDeepDiveAt ?? null,
      input.deepDiveTriggeredBy ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.stance ?? null,
      input.potentialScore ?? null,
      input.urgencyScore ?? null,
      input.urgencyLabel ?? null,
      input.portfolioFitScore ?? null,
      input.suggestedAllocationPct ?? null,
      input.suggestedAllocationIls ?? null,
      JSON.stringify(input.actionCatalysts ?? []),
      JSON.stringify(input.avoidConditions ?? []),
      input.nextReviewAt ?? null,
      input.assetClass ?? "equity",
    ];

    const rows = (await manager.query(
      `INSERT INTO strategies (
         user_id, ticker, version, asset_scope, tracking_status, verdict, confidence,
         reasoning, timeframe, position_size_ils, position_weight_pct,
         entry_conditions, exit_conditions, catalysts, bull_case, bear_case,
         last_deep_dive_at, deep_dive_triggered_by, metadata, stance,
         potential_score, urgency_score, urgency_label, portfolio_fit_score,
         suggested_allocation_pct, suggested_allocation_ils, action_catalysts,
         avoid_conditions, next_review_at, asset_class,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12::jsonb, $13::jsonb, $14::jsonb, $15, $16,
         $17, $18, $19::jsonb, $20,
         $21, $22, $23, $24,
         $25, $26, $27::jsonb, $28::jsonb, $29, $30,
         NOW(), NOW()
       )
       ON CONFLICT (user_id, ticker) DO UPDATE SET
         version = EXCLUDED.version,
         asset_scope = EXCLUDED.asset_scope,
         tracking_status = EXCLUDED.tracking_status,
         verdict = EXCLUDED.verdict,
         confidence = EXCLUDED.confidence,
         reasoning = EXCLUDED.reasoning,
         timeframe = EXCLUDED.timeframe,
         position_size_ils = EXCLUDED.position_size_ils,
         position_weight_pct = EXCLUDED.position_weight_pct,
         entry_conditions = EXCLUDED.entry_conditions,
         exit_conditions = EXCLUDED.exit_conditions,
         catalysts = EXCLUDED.catalysts,
         bull_case = EXCLUDED.bull_case,
         bear_case = EXCLUDED.bear_case,
         last_deep_dive_at = EXCLUDED.last_deep_dive_at,
         deep_dive_triggered_by = EXCLUDED.deep_dive_triggered_by,
         metadata = EXCLUDED.metadata,
         stance = EXCLUDED.stance,
         potential_score = EXCLUDED.potential_score,
         urgency_score = EXCLUDED.urgency_score,
         urgency_label = EXCLUDED.urgency_label,
         portfolio_fit_score = EXCLUDED.portfolio_fit_score,
         suggested_allocation_pct = EXCLUDED.suggested_allocation_pct,
         suggested_allocation_ils = EXCLUDED.suggested_allocation_ils,
         action_catalysts = EXCLUDED.action_catalysts,
         avoid_conditions = EXCLUDED.avoid_conditions,
         next_review_at = EXCLUDED.next_review_at,
         asset_class = EXCLUDED.asset_class,
         updated_at = NOW()
       RETURNING ${SELECT_COLUMNS}`,
      params
    )) as StrategyRow[];

    return { record: fromRow(rows[0]!), created, previousVersion };
  });
}

/**
 * Bump a strategy's version without touching any other field. Used when an
 * external trigger explicitly invalidates the current strategy (e.g. corporate
 * action ingest) without producing a new analyst pipeline run.
 */
export async function bumpVersion(userId: string, ticker: string): Promise<StrategyRecord | null> {
  if (!isApplicationDatabaseConfigured()) return null;
  const ds = await getApplicationDataSource();
  const rows = (await ds.query(
    `UPDATE strategies
        SET version = version + 1, updated_at = NOW()
      WHERE user_id = $1 AND ticker = $2
      RETURNING ${SELECT_COLUMNS}`,
    [userId, normalizeTicker(ticker)]
  )) as StrategyRow[];
  return rows[0] ? fromRow(rows[0]) : null;
}
