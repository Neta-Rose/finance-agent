export type Verdict = "BUY" | "ADD" | "HOLD" | "REDUCE" | "SELL" | "CLOSE";
export type Confidence = "high" | "medium" | "low";
export type Exchange = "TASE" | "NYSE" | "NASDAQ";
export type JobStatus = "pending" | "running" | "completed" | "failed";
export type JobAction =
 | "daily_brief" | "full_report" | "deep_dive"
 | "new_ideas" | "switch_production" | "switch_testing";
export type PortfolioState = "UNINITIALIZED" | "BOOTSTRAPPING" | "ACTIVE";

export interface PositionRow {
 ticker: string;
 exchange: Exchange;
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

export interface PortfolioResponse {
 updatedAt: string;
 usdIlsRate: number;
 totalILS: number;
 totalCostILS: number;
 totalPlILS: number;
 totalPlPct: number;
 positions: PositionRow[];
}

export interface StrategyCatalyst {
 description: string;
 expiresAt: string | null;
 triggered: boolean;
}

export interface StrategyRow {
 ticker: string;
 verdict: Verdict;
 confidence: Confidence;
 reasoning: string;
 timeframe: string;
 positionSizeILS: number;
 positionWeightPct: number;
 entryConditions: string[];
 exitConditions: string[];
 catalysts: StrategyCatalyst[];
 hasExpiredCatalysts: boolean;
 lastDeepDiveAt: string | null;
 updatedAt: string;
 version: number;
}

export interface StrategiesResponse {
 updatedAt: string;
 strategies: StrategyRow[];
}

export interface VerdictRow {
 ticker: string;
 verdict: Verdict;
 confidence: Confidence;
 timeframe: string;
 reasoning: string;
 positionSizeILS: number;
 positionWeightPct: number;
 entryConditions: string[];
 exitConditions: string[];
 catalysts: StrategyCatalyst[];
 lastDeepDiveAt: string | null;
 updatedAt: string;
 hasExpiredCatalysts: boolean;
}

export interface VerdictsResponse {
 updatedAt: string;
 verdicts: VerdictRow[];
}

export interface Job {
 id: string;
 action: JobAction;
 ticker: string | null;
 status: JobStatus;
 triggered_at: string;
 started_at: string | null;
 completed_at: string | null;
 result: string | null;
 error: string | null;
}

export interface JobsResponse { jobs: Job[]; }
export interface TriggerResponse { jobId: string; job: Job; }

export interface TickerConditionResult {
 ticker: string;
 needsEscalation: boolean;
 escalationReasons: string[];
 escalationDetails: string[];
 lastDeepDiveAt: string | null;
 daysSinceDeepDive: number | null;
 verdict: string;
 confidence: string;
 expiredCatalysts: Array<{
 description: string;
 expiredAt: string;
 daysOverdue: number;
 }>;
 onTrack: boolean;
}

export interface ConditionReport {
 userId: string;
 generatedAt: string;
 totalTickers: number;
 needsEscalation: TickerConditionResult[];
 onTrack: TickerConditionResult[];
 errors: Array<{ ticker: string; error: string }>;
 summary: string;
}

export interface OnboardStatus {
 userId: string;
 state: PortfolioState;
 displayName: string;
 bootstrapProgress: {
 total: number;
 completed: number;
 completedTickers: string[];
 pct: number;
 } | null;
 portfolioLoaded: boolean;
 readyForTrading: boolean;
}
