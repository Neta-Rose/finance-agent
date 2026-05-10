import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { MAX_COMPOSED_BODY_LENGTH } from "./notificationComposer.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "notification-service-"));
process.env["USERS_DIR"] = path.join(testRoot, "users");

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function writeProfile(
  userId: string,
  options?: {
    primaryChannel?: "telegram" | "web" | "whatsapp" | "none";
    enabledChannels?: { telegram: boolean; web: boolean; whatsapp: boolean };
    categories?: { dailyBriefs: boolean; reportRuns: boolean; marketNews: boolean };
    channelConnections?: Record<string, unknown>;
  }
): Promise<void> {
  await writeJson(path.join(process.env["USERS_DIR"]!, userId, "profile.json"), {
    notifications: {
      primaryChannel: options?.primaryChannel ?? "web",
      enabledChannels: options?.enabledChannels ?? {
        telegram: false,
        web: true,
        whatsapp: false,
      },
      categories: options?.categories ?? {
        dailyBriefs: true,
        reportRuns: true,
        marketNews: true,
      },
    },
    ...(options?.channelConnections ? { channelConnections: options.channelConnections } : {}),
  });
}

test("publishNotification composes daily brief web records and markNotificationsRead marks them read", async () => {
  const { publishNotification, listNotifications, markNotificationsRead } = await import("./notificationService.js");
  const userId = "notify-user";
  await writeProfile(userId);

  const created = await publishNotification({
    userId,
    kind: "daily_brief",
    headline: "Daily brief needs deeper review",
    summary: "Needs deeper review: AAPL, MSFT.",
    ticker: "AAPL",
    batchId: "batch_1",
    actionUrl: "/reports?batch=batch_1",
  });

  assert.equal(created.length, 1);
  assert.equal(created[0]?.channel, "web");
  assert.equal(created[0]?.category, "daily_brief");
  assert.equal(created[0]?.title, "Daily brief needs deeper review: AAPL");
  assert.equal(created[0]?.body, "Needs deeper review: AAPL, MSFT.\n\nOpen: /reports?batch=batch_1");

  const unread = await listNotifications(userId, { channel: "web", unreadOnly: true, limit: 10 });
  assert.equal(unread.length, 1);
  assert.equal(unread[0]?.readAt, null);

  const updated = await markNotificationsRead(userId, [unread[0]!.id]);
  assert.equal(updated, 1);

  const after = await listNotifications(userId, { channel: "web", unreadOnly: true, limit: 10 });
  assert.equal(after.length, 0);
});

test("publishNotification composes report and market news records with backward-compatible fields", async () => {
  const { publishNotification, listNotifications } = await import("./notificationService.js");
  const userId = "report-news-user";
  await writeProfile(userId);

  const report = await publishNotification({
    userId,
    kind: "full_report",
    summary: "Refreshed 3 tickers.",
    ticker: "MSFT",
    batchId: "batch_full_report",
  });
  const news = await publishNotification({
    userId,
    kind: "market_news",
    headline: "Fed decision moves rates",
    summary: "Policy-sensitive names moved after the decision.",
    ticker: "SPY",
  });

  assert.equal(report[0]?.category, "report");
  assert.equal(report[0]?.title, "Full report ready: MSFT");
  assert.equal(report[0]?.body, "Refreshed 3 tickers.");
  assert.equal(news[0]?.category, "market_news");
  assert.equal(news[0]?.title, "Fed decision moves rates: SPY");
  assert.equal(news[0]?.body, "Policy-sensitive names moved after the decision.");

  const items = await listNotifications(userId, { channel: "web", limit: 10 });
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(typeof item.title, "string");
    assert.equal(typeof item.body, "string");
    assert.ok(["daily_brief", "report", "market_news"].includes(item.category));
    assert.equal(item.delivered, true);
    assert.equal(item.error, null);
    assert.equal(item.readAt, null);
  }
});

test("publishNotification is idempotent for report batch ids", async () => {
  const { publishNotification, listNotifications } = await import("./notificationService.js");
  const userId = "dedupe-user";
  await writeProfile(userId);

  const first = await publishNotification({
    userId,
    kind: "deep_dive",
    reasoning: "AAPL report is ready.",
    ticker: "AAPL",
    batchId: "batch_duplicate_deep_dive",
  });
  const second = await publishNotification({
    userId,
    kind: "deep_dive",
    reasoning: "Different body should not create a duplicate.",
    ticker: "AAPL",
    batchId: "batch_duplicate_deep_dive",
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0]?.id, first[0]?.id);
  assert.equal(second[0]?.body, first[0]?.body);

  const items = await listNotifications(userId, { channel: "web", limit: 10 });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.batchId, "batch_duplicate_deep_dive");
});

test("publishNotification respects category preference filtering", async () => {
  const { publishNotification, listNotifications } = await import("./notificationService.js");
  const userId = "disabled-report-user";
  await writeProfile(userId, {
    categories: {
      dailyBriefs: true,
      reportRuns: false,
      marketNews: true,
    },
  });

  const created = await publishNotification({
    userId,
    kind: "quick_check",
    summary: "Quick check completed.",
    ticker: "NVDA",
    batchId: "batch_disabled_report",
  });

  assert.deepEqual(created, []);
  const items = await listNotifications(userId, { channel: "web", limit: 10 });
  assert.equal(items.length, 0);
});

test("publishNotification bounds deep-dive reasoning instead of storing raw unbounded strategy text", async () => {
  const { publishNotification } = await import("./notificationService.js");
  const userId = "bounded-reasoning-user";
  await writeProfile(userId);
  const longReasoning = "raw strategy reasoning ".repeat(200);

  const created = await publishNotification({
    userId,
    kind: "deep_dive",
    reasoning: longReasoning,
    ticker: "TSLA",
    batchId: "batch_long_reasoning",
  });

  assert.equal(created.length, 1);
  assert.equal(created[0]?.title, "Deep-dive report ready: TSLA");
  assert.ok(created[0]!.body.length <= MAX_COMPOSED_BODY_LENGTH);
  assert.notEqual(created[0]?.body, longReasoning);
  assert.match(created[0]!.body, /…$/);
});

test("publishNotification handles missing optional ticker and batch fields", async () => {
  const { publishNotification } = await import("./notificationService.js");
  const userId = "missing-optional-user";
  await writeProfile(userId);

  const created = await publishNotification({
    userId,
    kind: "new_ideas",
    summary: "",
  });

  assert.equal(created.length, 1);
  assert.equal(created[0]?.category, "report");
  assert.equal(created[0]?.title, "New ideas ready");
  assert.equal(created[0]?.body, "New report ideas are ready to review.");
  assert.equal(created[0]?.ticker, null);
  assert.equal(created[0]?.batchId, null);
});

test("getNotificationPreferences falls back to web when external channels are not connected", async () => {
  const { getNotificationPreferences } = await import("./notificationService.js");
  const userId = "stale-channel-user";

  await writeProfile(userId, {
    primaryChannel: "telegram",
    enabledChannels: {
      telegram: true,
      web: true,
      whatsapp: true,
    },
  });

  const preferences = await getNotificationPreferences(userId);
  assert.equal(preferences.primaryChannel, "web");
  assert.equal(preferences.enabledChannels.web, true);
  assert.equal(preferences.enabledChannels.telegram, false);
  assert.equal(preferences.enabledChannels.whatsapp, false);
});

test("publishNotification records telegram failure when target is missing bot token", async () => {
  const { publishNotification, listNotifications } = await import("./notificationService.js");
  const userId = "telegram-missing-token-user";
  await writeProfile(userId, {
    primaryChannel: "telegram",
    enabledChannels: {
      telegram: true,
      web: false,
      whatsapp: false,
    },
    channelConnections: {
      telegram: {
        chatId: "chat-missing-token",
      },
    },
  });

  const created = await publishNotification({
    userId,
    kind: "daily_brief",
    summary: "Telegram should fail without a bot token.",
    batchId: "batch_missing_telegram_target",
  });

  assert.equal(created.length, 1);
  assert.equal(created[0]?.channel, "telegram");

  const items = await listNotifications(userId, { channel: "telegram", limit: 10 });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.delivered, false);
  assert.equal(items[0]?.deliveredAt, null);
  assert.equal(items[0]?.error, "telegram target not configured");
});

test("publishNotification records redacted telegram non-2xx failures", async () => {
  const originalFetch = global.fetch;
  const token = "123456:notification-secret-token";
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(`bad token ${token} https://api.telegram.org/bot${token}/sendMessage`, {
      status: 500,
    });
  }) as typeof fetch;

  try {
    const { publishNotification, listNotifications } = await import("./notificationService.js");
    const userId = "telegram-http-failure-user";
    await writeProfile(userId, {
      primaryChannel: "telegram",
      enabledChannels: {
        telegram: true,
        web: false,
        whatsapp: false,
      },
      channelConnections: {
        telegram: {
          botToken: token,
          chatId: "chat-http-failure",
        },
      },
    });

    const created = await publishNotification({
      userId,
      kind: "market_news",
      headline: "Fed decision *moves* markets",
      summary: "Telegram API should fail and persist a redacted reason.",
      batchId: "batch_telegram_http_failure",
    });

    assert.equal(created.length, 1);
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
    assert.equal(body["parse_mode"], undefined);
    assert.equal(body["disable_web_page_preview"], true);
    assert.match(String(body["text"]), /Fed decision moves markets/);

    const items = await listNotifications(userId, { channel: "telegram", limit: 10 });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.delivered, false);
    assert.equal(items[0]?.deliveredAt, null);
    assert.match(items[0]?.error ?? "", /telegram http 500/);
    assert.doesNotMatch(items[0]?.error ?? "", /notification-secret-token/);
    assert.doesNotMatch(items[0]?.error ?? "", /bot123456:notification-secret-token/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("publishNotification delivers to whatsapp when whatsapp is connected and enabled", async () => {
  const originalFetch = global.fetch;
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const { publishNotification, listNotifications } = await import("./notificationService.js");
    const userId = "whatsapp-user";

    await writeProfile(userId, {
      primaryChannel: "whatsapp",
      enabledChannels: {
        telegram: false,
        web: false,
        whatsapp: true,
      },
      channelConnections: {
        whatsapp: {
          accessToken: "test-access-token-1234567890",
          phoneNumberId: "1234567890",
          recipientPhone: "+14155550123",
        },
      },
    });

    const created = await publishNotification({
      userId,
      kind: "deep_dive",
      reasoning: "AAPL report is ready.",
      ticker: "AAPL",
      batchId: "batch_2",
    });

    assert.equal(created.length, 1);
    assert.equal(created[0]?.channel, "whatsapp");
    assert.equal(requests.length, 1);
    assert.match(requests[0]!.url, /graph\.facebook\.com/);

    const body = JSON.parse(String(requests[0]!.init?.body));
    assert.equal(body.messaging_product, "whatsapp");
    assert.equal(body.to, "+14155550123");
    assert.equal(body.text.body, "Deep-dive report ready: AAPL\nAAPL report is ready.");

    const items = await listNotifications(userId, { channel: "whatsapp", limit: 10 });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.delivered, true);
    assert.equal(items[0]?.error, null);
  } finally {
    global.fetch = originalFetch;
  }
});
