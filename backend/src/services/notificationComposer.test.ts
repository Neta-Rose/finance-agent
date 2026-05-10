import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COMPOSED_BODY_LENGTH,
  MAX_TELEGRAM_MESSAGE_LENGTH,
  composeNotification,
  renderTelegramNotification,
  renderWebNotification,
} from "./notificationComposer.js";

const rawReasoning = "Internal reasoning: " + "why ".repeat(500);

test("notification composer maps owned semantic kinds to persisted categories", () => {
  const cases = [
    { kind: "daily_brief", category: "daily_brief" },
    { kind: "deep_dive", category: "report" },
    { kind: "full_report", category: "report" },
    { kind: "quick_check", category: "report" },
    { kind: "new_ideas", category: "report" },
    { kind: "market_news", category: "market_news" },
  ] as const;

  for (const item of cases) {
    const composed = composeNotification({
      kind: item.kind,
      ticker: "AAPL",
      title: "  Ready  ",
      summary: "A useful bounded summary.",
      batchId: "batch-1",
      actionUrl: "/reports/AAPL",
    });

    assert.equal(composed.kind, item.kind);
    assert.equal(composed.category, item.category);
    assert.equal(composed.ticker, "AAPL");
    assert.equal(composed.batchId, "batch-1");
    assert.equal(composed.actionUrl, "/reports/AAPL");
    assert.ok(composed.title.length > 0);
    assert.ok(composed.body.length > 0);
  }
});

test("daily brief renders clear web and telegram messages with action cue", () => {
  const composed = composeNotification({
    kind: "daily_brief",
    status: "success",
    title: "Daily brief complete",
    summary: "Your morning review is ready with three portfolio updates.",
    actionUrl: "/daily-briefs/2026-04-11",
  });

  const web = renderWebNotification(composed);
  assert.equal(web.category, "daily_brief");
  assert.equal(web.title, "Daily brief complete");
  assert.match(web.body, /morning review/);
  assert.match(web.body, /Open:/);

  const telegram = renderTelegramNotification(composed);
  assert.match(telegram.text, /^✅ Daily brief complete/);
  assert.match(telegram.text, /Open: \/daily-briefs\/2026-04-11/);
  assert.equal(telegram.parseMode, undefined);
  assert.equal(telegram.disableWebPagePreview, true);
});

test("report variants use useful fallback copy without requiring optional fields", () => {
  const deepDive = composeNotification({ kind: "deep_dive", ticker: "MSFT", summary: "" });
  const fullReport = composeNotification({ kind: "full_report", ticker: "NVDA" });
  const quickCheck = composeNotification({ kind: "quick_check", title: "", ticker: "TSLA" });
  const newIdeas = composeNotification({ kind: "new_ideas" });

  for (const composed of [deepDive, fullReport, quickCheck, newIdeas]) {
    assert.equal(composed.category, "report");
    assert.doesNotThrow(() => renderWebNotification(composed));
    assert.doesNotThrow(() => renderTelegramNotification(composed));
    assert.ok(composed.title.length > 0);
    assert.ok(composed.body.length > 0);
  }

  assert.match(deepDive.title, /MSFT/);
  assert.match(fullReport.title, /NVDA/);
  assert.match(quickCheck.title, /TSLA/);
});

test("market news normalizes empty headline and preserves valid ticker", () => {
  const composed = composeNotification({
    kind: "market_news",
    ticker: "goog",
    headline: "",
    summary: "   ",
  });

  assert.equal(composed.category, "market_news");
  assert.equal(composed.ticker, "GOOG");
  assert.match(composed.title, /Market news/);
  assert.match(composed.body, /Market update available/);
});

test("renderer clips overlong reasoning and does not leak raw full analysis", () => {
  const composed = composeNotification({
    kind: "full_report",
    ticker: "AAPL",
    reasoning: rawReasoning,
    summary: rawReasoning,
  });
  const web = renderWebNotification(composed);
  const telegram = renderTelegramNotification(composed);

  assert.ok(composed.body.length <= MAX_COMPOSED_BODY_LENGTH);
  assert.ok(web.body.length <= MAX_COMPOSED_BODY_LENGTH + 80);
  assert.ok(telegram.text.length <= MAX_TELEGRAM_MESSAGE_LENGTH);
  assert.doesNotMatch(web.body, /why why why why why why why why why why why why why why why why why why why why/);
  assert.doesNotMatch(telegram.text, /why why why why why why why why why why why why why why why why why why why why/);
});

test("markdown-like untrusted input is rendered as plain safe telegram text", () => {
  const composed = composeNotification({
    kind: "deep_dive",
    ticker: "A*PL\n",
    title: "*[Buy now](https://example.test)* <script>alert(1)</script>",
    summary: "Line one\u0000\n# heading `code` [link](https://evil.test)",
    actionUrl: "https://example.test/report?a=1",
  });
  const telegram = renderTelegramNotification(composed);
  const web = renderWebNotification(composed);

  assert.equal(composed.ticker, "APL");
  assert.doesNotMatch(telegram.text, /<script>|<\/script>|\u0000/);
  assert.doesNotMatch(telegram.text, /\*\[Buy now\]/);
  assert.doesNotMatch(telegram.text, /`code`/);
  assert.match(telegram.text, /Buy now/);
  assert.match(web.title, /Buy now/);
});

test("telegram rendering stays below the max message boundary", () => {
  const composed = composeNotification({
    kind: "market_news",
    title: "Market news",
    summary: "x".repeat(MAX_TELEGRAM_MESSAGE_LENGTH + 500),
    actionUrl: "/news/latest",
  });

  const telegram = renderTelegramNotification(composed);
  assert.ok(telegram.text.length <= MAX_TELEGRAM_MESSAGE_LENGTH);
  assert.match(telegram.text, /Open: \/news\/latest/);
});
