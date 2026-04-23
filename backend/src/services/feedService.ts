import { promises as fs } from "fs";
import path from "path";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import { resolveConfiguredPath } from "./paths.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const MAX_STORED_EVENTS = 250;
export const FEED_PAGE_SIZE = 15;

export interface StoredBatchEntry {
  ticker: string;
  mode: string;
  verdict: string;
  confidence: string;
  reasoning: string;
  timeframe: string;
  analystTypes: string[];
  hasBullCase: boolean;
  hasBearCase: boolean;
}

export interface StoredBatch {
  batchId: string;
  triggeredAt: string;
  date: string;
  mode: string;
  tickers: string[];
  tickerCount: number;
  jobId: string | null;
  entries: Record<string, StoredBatchEntry>;
  summary?: {
    headline?: string;
    today?: string;
    tomorrow?: string;
    marketView?: string;
    securityNote?: string;
    dashboardPath?: string;
  };
  highlights?: string[];
}

export interface FeedEventRecord {
  id: string;
  kind: "market_news";
  createdAt: string;
  ticker: string;
  title: string;
  summary: string;
  source: string;
  url: string | null;
}

export interface FeedItem {
  id: string;
  createdAt: string;
  kind: "report" | "daily_brief" | "market_news";
  mode: string;
  tone: "emerald" | "amber" | "rose" | "sky" | "slate";
  compact: boolean;
  title: string;
  summary: string;
  tickers: string[];
  tickerCount: number;
  batchId: string | null;
  entries: Record<string, StoredBatchEntry>;
  highlights: string[];
  dailyBrief:
    | {
        headline: string | null;
        today: string | null;
        tomorrow: string | null;
        marketView: string | null;
        securityNote: string | null;
        dashboardPath: string | null;
      }
    | null;
  event:
    | {
        ticker: string;
        source: string;
        url: string | null;
      }
    | null;
}

export interface FeedQuery {
  pageNum: number;
  mode?: string | null;
  search?: string | null;
}

function feedEventsPath(userId: string): string {
  return path.join(USERS_DIR, userId, "feed", "events.json");
}

function toneForMode(mode: string): FeedItem["tone"] {
  switch (mode) {
    case "daily_brief":
      return "sky";
    case "deep_dive":
      return "rose";
    case "full_report":
      return "emerald";
    case "new_ideas":
      return "amber";
    default:
      return "amber";
  }
}

function determineReportTone(batch: StoredBatch): FeedItem["tone"] {
  const entries = Object.values(batch.entries);
  const hasNegative = entries.some((entry) => ["REDUCE", "SELL", "CLOSE"].includes(entry.verdict));
  const hasPositive = entries.some((entry) => ["BUY", "ADD"].includes(entry.verdict));

  if (batch.mode === "quick_check") {
    return hasNegative ? "rose" : "emerald";
  }
  if (batch.mode === "daily_brief") {
    return hasNegative ? "rose" : "sky";
  }
  if (batch.mode === "deep_dive" || batch.mode === "full_report") {
    if (hasNegative) return "rose";
    if (hasPositive) return "emerald";
    return "amber";
  }
  if (batch.mode === "new_ideas") {
    return "amber";
  }
  return toneForMode(batch.mode);
}

function summarizeBatch(batch: StoredBatch): string {
  const primaryTicker = batch.tickers[0] ?? null;
  const primaryEntry = primaryTicker ? batch.entries?.[primaryTicker] : null;

  switch (batch.mode) {
    case "quick_check":
      return primaryEntry?.reasoning ?? `Quick check completed for ${primaryTicker ?? "position"}.`;
    case "daily_brief": {
      if (batch.summary?.headline) return batch.summary.headline;
      const escalated = Object.values(batch.entries).filter((entry) =>
        ["REDUCE", "SELL", "CLOSE"].includes(entry.verdict)
      ).length;
      if (escalated > 0) {
        return `${escalated} position${escalated === 1 ? "" : "s"} need closer attention.`;
      }
      return `Daily brief completed across ${batch.tickerCount} position${batch.tickerCount === 1 ? "" : "s"}.`;
    }
    case "deep_dive":
      return primaryEntry?.reasoning ?? `Deep dive refreshed for ${primaryTicker ?? "ticker"}.`;
    case "full_report":
      return `Full report refreshed across ${batch.tickerCount} ticker${batch.tickerCount === 1 ? "" : "s"}.`;
    case "new_ideas":
      return primaryEntry?.reasoning ?? `Generated ${batch.tickerCount} new idea${batch.tickerCount === 1 ? "" : "s"}.`;
    default:
      return `Generated ${batch.mode.replace(/_/g, " ")}.`;
  }
}

function buildHighlights(batch: StoredBatch): string[] {
  if (batch.highlights?.length) return batch.highlights.slice(0, 4);
  if (batch.mode === "daily_brief") {
    const escalated = Object.values(batch.entries)
      .filter((entry) => ["REDUCE", "SELL", "CLOSE"].includes(entry.verdict))
      .map((entry) => `${entry.ticker} needs follow-up`);
    return escalated.slice(0, 3);
  }

  return Object.values(batch.entries)
    .slice(0, 3)
    .map((entry) => `${entry.ticker} · ${entry.verdict} · ${entry.confidence}`);
}

function titleForBatch(batch: StoredBatch): string {
  switch (batch.mode) {
    case "quick_check":
      return `${batch.tickers[0] ?? "Position"} quick check`;
    case "daily_brief":
      return "Daily brief";
    case "deep_dive":
      return `${batch.tickers[0] ?? "Ticker"} deep dive`;
    case "full_report":
      return "Full report";
    case "new_ideas":
      return "New ideas";
    default:
      return batch.mode.replace(/_/g, " ");
  }
}

export function buildReportFeedItems(batches: StoredBatch[]): FeedItem[] {
  return batches.map((batch) => ({
    id: batch.batchId,
    createdAt: batch.triggeredAt,
    kind: batch.mode === "daily_brief" ? "daily_brief" : "report",
    mode: batch.mode,
    tone: determineReportTone(batch),
    compact: batch.mode === "quick_check" || batch.mode === "daily_brief",
    title: titleForBatch(batch),
    summary: summarizeBatch(batch),
    tickers: batch.tickers,
    tickerCount: batch.tickerCount,
    batchId: batch.batchId,
    entries: batch.entries,
    highlights: buildHighlights(batch),
    dailyBrief: batch.mode === "daily_brief"
      ? {
          headline: batch.summary?.headline ?? null,
          today: batch.summary?.today ?? null,
          tomorrow: batch.summary?.tomorrow ?? null,
          marketView: batch.summary?.marketView ?? null,
          securityNote: batch.summary?.securityNote ?? null,
          dashboardPath: batch.summary?.dashboardPath ?? null,
        }
      : null,
    event: null,
  }));
}

export async function listFeedEvents(userId: string, limit = 100): Promise<FeedEventRecord[]> {
  try {
    const raw = await fs.readFile(feedEventsPath(userId), "utf-8");
    const parsed = JSON.parse(raw) as FeedEventRecord[];
    return parsed.slice(0, limit);
  } catch {
    return [];
  }
}

export async function appendFeedEvent(
  userId: string,
  event: Omit<FeedEventRecord, "id" | "createdAt">
): Promise<FeedEventRecord> {
  const record: FeedEventRecord = {
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...event,
  };

  const filePath = feedEventsPath(userId);
  let current: FeedEventRecord[] = [];
  try {
    current = JSON.parse(await fs.readFile(filePath, "utf-8")) as FeedEventRecord[];
  } catch {}

  const next = [record, ...current].slice(0, MAX_STORED_EVENTS);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf-8");
  try {
    const { publishNotification } = await import("./notificationService.js");
    await publishNotification({
      userId,
      category: "market_news",
      title: event.title,
      body: event.summary,
      ticker: event.ticker,
      batchId: null,
    });
  } catch {
    // Feed event storage stays authoritative even if notification publication fails.
  }
  return record;
}

async function readAllReportBatches(
  ws: UserWorkspace,
  readCurrentMeta: (ws: UserWorkspace) => Promise<{ totalPages: number }>,
  readCurrentPage: (ws: UserWorkspace, pageNum: number) => Promise<{ page: number; totalPages: number; batches: StoredBatch[] } | null>
): Promise<StoredBatch[]> {
  const meta = await readCurrentMeta(ws);
  const totalPages = Math.max(1, meta.totalPages || 1);
  const pages = await Promise.all(
    Array.from({ length: totalPages }, (_, index) => readCurrentPage(ws, index + 1))
  );
  return pages.flatMap((page) => page?.batches ?? []);
}

function toEventFeedItem(event: FeedEventRecord): FeedItem {
  return {
    id: event.id,
    createdAt: event.createdAt,
    kind: "market_news",
    mode: "market_news",
    tone: "slate",
    compact: true,
    title: event.title,
    summary: event.summary,
    tickers: [event.ticker],
    tickerCount: 1,
    batchId: null,
    entries: {},
    highlights: [event.ticker, event.source],
    dailyBrief: null,
    event: {
      ticker: event.ticker,
      source: event.source,
      url: event.url,
    },
  };
}

function matchesFeedItem(item: FeedItem, mode: string | null | undefined, search: string | null | undefined): boolean {
  if (mode && mode !== "all") {
    const normalizedMode = mode.toLowerCase();
    if (normalizedMode === "events" && item.kind !== "market_news") return false;
    if (normalizedMode === "reports" && item.kind === "market_news") return false;
    if (normalizedMode !== "events" && normalizedMode !== "reports" && item.mode !== normalizedMode) return false;
  }

  if (!search?.trim()) return true;

  const haystack = [
    item.title,
    item.summary,
    item.mode,
    item.tickers.join(" "),
    ...item.highlights,
    ...Object.values(item.entries).map(
      (entry) => `${entry.ticker} ${entry.reasoning} ${entry.verdict} ${entry.confidence} ${entry.timeframe}`
    ),
  ]
    .join(" ")
    .toLowerCase();

  // Tokenised: every whitespace-separated word must appear somewhere in the haystack.
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

export async function readFeedPage(
  ws: UserWorkspace,
  query: FeedQuery,
  readCurrentMeta: (ws: UserWorkspace) => Promise<{ totalPages: number }>,
  readCurrentPage: (ws: UserWorkspace, pageNum: number) => Promise<{
    page: number;
    totalPages: number;
    batches: StoredBatch[];
  } | null>
): Promise<{
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  appliedMode: string | null;
  appliedSearch: string | null;
  items: FeedItem[];
}> {
  const [batches, events] = await Promise.all([
    readAllReportBatches(ws, readCurrentMeta, readCurrentPage),
    listFeedEvents(ws.userId, MAX_STORED_EVENTS),
  ]);

  const allItems = [...events.map(toEventFeedItem), ...buildReportFeedItems(batches)]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .filter((item) => matchesFeedItem(item, query.mode, query.search));

  const totalItems = allItems.length;
  // When a search query is active, return all matching items on one page so the
  // client can show complete results without requiring the user to paginate.
  const effectivePageSize = query.search?.trim() ? Math.max(totalItems, 1) : FEED_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const safePage = Math.min(Math.max(query.pageNum, 1), totalPages);
  const start = (safePage - 1) * effectivePageSize;

  return {
    page: safePage,
    totalPages,
    totalItems,
    pageSize: effectivePageSize,
    appliedMode: query.mode ?? null,
    appliedSearch: query.search ?? null,
    items: allItems.slice(start, start + effectivePageSize),
  };
}
