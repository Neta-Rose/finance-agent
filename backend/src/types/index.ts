export type Verdict = "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "CLOSE";

export interface RateLimits {
  full_report: { maxPerPeriod: number; periodHours: number };
  daily_brief: { maxPerPeriod: number; periodHours: number };
  deep_dive: { maxPerPeriod: number; periodHours: number };
  new_ideas: { maxPerPeriod: number; periodHours: number };
  quick_check: { maxPerPeriod: number; periodHours: number };
}

export interface TokenBudgetWindow {
  maxTokens: number;
  periodHours: number;
}

export interface TokenBudgets {
  conversation: TokenBudgetWindow;
  structured: TokenBudgetWindow;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  full_report: { maxPerPeriod: 1, periodHours: 168 },
  daily_brief: { maxPerPeriod: 3, periodHours: 24 },
  deep_dive: { maxPerPeriod: 5, periodHours: 24 },
  new_ideas: { maxPerPeriod: 2, periodHours: 168 },
  quick_check: { maxPerPeriod: 20, periodHours: 24 }, // More frequent since lighter
};

export const DEFAULT_TOKEN_BUDGETS: TokenBudgets = {
  conversation: { maxTokens: 20_000, periodHours: 6 },
  structured: { maxTokens: 250_000, periodHours: 24 },
};

export type Confidence = "high" | "medium" | "low";

export type Exchange = "TASE" | "NYSE" | "NASDAQ" | "LSE" | "XETRA" | "EURONEXT" | "OTHER";

export type AnalystType =
  | "fundamentals"
  | "technical"
  | "sentiment"
  | "macro"
  | "risk"
  | "bull"
  | "bear";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JobAction =
  | "daily_brief"
  | "full_report"
  | "deep_dive"
  | "new_ideas"
  | "quick_check"
  | "switch_production"
  | "switch_testing";

export type JobSource =
  | "backend_job"
  | "telegram_command"
  | "dashboard_action";

export type PortfolioState =
  | "INCOMPLETE"
  | "BOOTSTRAPPING"
  | "ACTIVE"
  | "BLOCKED";

export type PositionGuidanceHorizon =
  | "unspecified"
  | "days"
  | "weeks"
  | "months"
  | "years";

export interface PositionGuidance {
  thesis: string;
  horizon: PositionGuidanceHorizon;
  addOn: string;
  reduceOn: string;
  notes: string;
}

export interface Position {
  ticker: string;
  exchange: Exchange;
  shares: number;
  unitAvgBuyPrice: number;
  unitCurrency: string;
}

export interface PortfolioAccount {
  [ticker: string]: Position;
}

export interface PortfolioStateData {
  userId: string;
  state: PortfolioState;
  lastFullReportAt: string | null;
  lastDailyAt: string | null;
  pendingDeepDives: string[];
  bootstrapProgress: {
    total: number;
    completed: number;
    completedTickers: string[];
  } | null;
  onboarding: {
    portfolioSubmittedAt: string | null;
    positionGuidanceStatus: "not_started" | "pending" | "completed" | "skipped";
    positionGuidance: Record<string, PositionGuidance>;
  };
}

export interface Job {
  id: string;
  action: JobAction;
  ticker: string | null;
  source?: JobSource | null;
  status: JobStatus;
  triggered_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: JsonValue;
  error: string | null;
}

export interface StrategyBucket {
  inPortfolio: boolean;
}

export interface BatchEntry {
  ticker: string;
  mode: string;
  verdict: Verdict;
  confidence: Confidence;
  reasoning: string;
  timeframe: string;
  analystTypes: AnalystType[];
  hasBullCase: boolean;
  hasBearCase: boolean;
}

export interface BatchMeta {
  batchId: string;
  triggeredAt: string;
  date: string;
  mode: string;
  tickers: string[];
  tickerCount: number;
  jobId: string | null;
  entries: Record<string, BatchEntry>;
}
