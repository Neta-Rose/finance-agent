import type { NotificationCategory } from "../db/entities/NotificationEntity.js";

export type SemanticNotificationKind =
  | "daily_brief"
  | "deep_dive"
  | "full_report"
  | "quick_check"
  | "new_ideas"
  | "market_news";

export type NotificationStatusTone = "info" | "success" | "warning";

export interface SemanticNotificationRequest {
  kind: SemanticNotificationKind;
  status?: NotificationStatusTone;
  title?: string | null;
  headline?: string | null;
  summary?: string | null;
  reasoning?: string | null;
  ticker?: string | null;
  batchId?: string | null;
  actionUrl?: string | null;
}

export interface ComposedNotification {
  kind: SemanticNotificationKind;
  category: NotificationCategory;
  status: NotificationStatusTone;
  title: string;
  body: string;
  ticker: string | null;
  batchId: string | null;
  actionUrl: string | null;
}

export interface WebNotificationRender {
  category: NotificationCategory;
  title: string;
  body: string;
  ticker: string | null;
  batchId: string | null;
}

export interface TelegramNotificationRender {
  text: string;
  parseMode: undefined;
  disableWebPagePreview: true;
}

export const MAX_COMPOSED_TITLE_LENGTH = 120;
export const MAX_COMPOSED_BODY_LENGTH = 700;
export const MAX_TELEGRAM_MESSAGE_LENGTH = 3600;

const STATUS_MARKERS: Record<NotificationStatusTone, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
};

const CATEGORY_BY_KIND: Record<SemanticNotificationKind, NotificationCategory> = {
  daily_brief: "daily_brief",
  deep_dive: "report",
  full_report: "report",
  quick_check: "report",
  new_ideas: "report",
  market_news: "market_news",
};

const DEFAULT_TITLES: Record<SemanticNotificationKind, string> = {
  daily_brief: "Daily brief ready",
  deep_dive: "Deep-dive report ready",
  full_report: "Full report ready",
  quick_check: "Quick check ready",
  new_ideas: "New ideas ready",
  market_news: "Market news update",
};

const DEFAULT_BODIES: Record<SemanticNotificationKind, string> = {
  daily_brief: "Your daily brief is ready to review.",
  deep_dive: "A deep-dive report is ready to review.",
  full_report: "A full report is ready to review.",
  quick_check: "A quick-check report is ready to review.",
  new_ideas: "New report ideas are ready to review.",
  market_news: "Market update available.",
};

function collapseRepeatedWords(value: string): string {
  const words = value.split(" ");
  const collapsed: string[] = [];
  for (let i = 0; i < words.length;) {
    const word = words[i]!;
    let j = i + 1;
    while (j < words.length && words[j]!.toLowerCase() === word.toLowerCase()) j += 1;
    const count = j - i;
    if (count > 6) {
      collapsed.push(`${word} ×${count}`);
    } else {
      collapsed.push(...words.slice(i, j));
    }
    i = j;
  }
  return collapsed.join(" ");
}

function normalizePlainText(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<\/?script\b[^>]*>/gi, " ")
    .replace(/[`*_~>#\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapseRepeatedWords(normalized);
}

function normalizeIdentifier(value: string | null | undefined, maxLength: number): string | null {
  const normalized = (value ?? "").trim().replace(/[^A-Za-z0-9._-]/g, "");
  return normalized.length > 0 ? clip(normalized, maxLength) : null;
}

function normalizeActionUrl(value: string | null | undefined, maxLength: number): string | null {
  const normalized = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/<\/?script\b[^>]*>/gi, "")
    .trim();
  return normalized.length > 0 ? clip(normalized, maxLength) : null;
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  return `${clipped}…`;
}

function normalizeTicker(value: string | null | undefined): string | null {
  const ticker = normalizePlainText(value).toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return ticker.length > 0 ? clip(ticker, 16) : null;
}

function withTicker(title: string, ticker: string | null): string {
  if (!ticker || title.toUpperCase().includes(ticker)) return title;
  return `${title}: ${ticker}`;
}

function defaultStatus(kind: SemanticNotificationKind): NotificationStatusTone {
  return kind === "market_news" ? "info" : "success";
}

function selectBody(request: SemanticNotificationRequest, kind: SemanticNotificationKind): string {
  const summary = normalizePlainText(request.summary);
  if (summary.length > 0) return clip(summary, MAX_COMPOSED_BODY_LENGTH);

  const reasoning = normalizePlainText(request.reasoning);
  if (reasoning.length > 0) return clip(reasoning, MAX_COMPOSED_BODY_LENGTH);

  return DEFAULT_BODIES[kind];
}

export function composeNotification(request: SemanticNotificationRequest): ComposedNotification {
  const kind = request.kind;
  const ticker = normalizeTicker(request.ticker);
  const rawTitle = normalizePlainText(request.title) || normalizePlainText(request.headline) || DEFAULT_TITLES[kind];
  const title = clip(withTicker(rawTitle, ticker), MAX_COMPOSED_TITLE_LENGTH);

  return {
    kind,
    category: CATEGORY_BY_KIND[kind],
    status: request.status ?? defaultStatus(kind),
    title,
    body: selectBody(request, kind),
    ticker,
    batchId: normalizeIdentifier(request.batchId, 128),
    actionUrl: normalizeActionUrl(request.actionUrl, 300),
  };
}

function appendActionCue(body: string, actionUrl: string | null, maxLength: number): string {
  if (!actionUrl) return clip(body, maxLength);
  const cue = `Open: ${actionUrl}`;
  const separator = body.length > 0 ? "\n\n" : "";
  const availableBodyLength = Math.max(0, maxLength - separator.length - cue.length);
  return `${clip(body, availableBodyLength)}${separator}${cue}`.trim();
}

export function renderWebNotification(composed: ComposedNotification): WebNotificationRender {
  return {
    category: composed.category,
    title: clip(composed.title, MAX_COMPOSED_TITLE_LENGTH),
    body: appendActionCue(composed.body, composed.actionUrl, MAX_COMPOSED_BODY_LENGTH + 80),
    ticker: composed.ticker,
    batchId: composed.batchId,
  };
}

export function renderTelegramNotification(composed: ComposedNotification): TelegramNotificationRender {
  const marker = STATUS_MARKERS[composed.status];
  const title = clip(composed.title, MAX_COMPOSED_TITLE_LENGTH);
  const prefix = `${marker} ${title}`;
  const bodyLimit = Math.max(0, MAX_TELEGRAM_MESSAGE_LENGTH - prefix.length - 2);
  const body = appendActionCue(composed.body, composed.actionUrl, bodyLimit);

  return {
    text: clip(`${prefix}\n${body}`.trim(), MAX_TELEGRAM_MESSAGE_LENGTH),
    parseMode: undefined,
    disableWebPagePreview: true,
  };
}
