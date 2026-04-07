export type Verdict = "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "CLOSE";

export type Confidence = "high" | "medium" | "low";

export type Exchange = "TASE" | "NYSE" | "NASDAQ";

export type AnalystType =
  | "fundamentals"
  | "technical"
  | "sentiment"
  | "macro"
  | "risk"
  | "bull"
  | "bear";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export type JobAction =
  | "daily_brief"
  | "full_report"
  | "deep_dive"
  | "new_ideas"
  | "switch_production"
  | "switch_testing";

export type PortfolioState =
  | "UNINITIALIZED"
  | "BOOTSTRAPPING"
  | "ACTIVE";

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
}

export interface Job {
  id: string;
  action: JobAction;
  ticker: string;
  status: JobStatus;
  triggered_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  error: string | null;
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
