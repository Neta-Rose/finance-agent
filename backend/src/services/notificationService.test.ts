import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "notification-service-"));
process.env["USERS_DIR"] = path.join(testRoot, "users");

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

test("publishNotification writes web outbox entries and markNotificationsRead marks them read", async () => {
  const { publishNotification, listNotifications, markNotificationsRead } = await import("./notificationService.js");
  const userId = "notify-user";

  await writeJson(path.join(process.env["USERS_DIR"]!, userId, "profile.json"), {
    notifications: {
      primaryChannel: "web",
      enabledChannels: {
        telegram: false,
        web: true,
        whatsapp: false,
      },
      categories: {
        dailyBriefs: true,
        reportRuns: true,
        marketNews: true,
      },
    },
  });

  const created = await publishNotification({
    userId,
    category: "daily_brief",
    title: "Daily brief",
    body: "Needs deeper review: AAPL, MSFT.",
    ticker: "AAPL",
    batchId: "batch_1",
  });

  assert.equal(created.length, 1);
  assert.equal(created[0]?.channel, "web");

  const unread = await listNotifications(userId, { channel: "web", unreadOnly: true, limit: 10 });
  assert.equal(unread.length, 1);
  assert.equal(unread[0]?.readAt, null);

  const updated = await markNotificationsRead(userId, [unread[0]!.id]);
  assert.equal(updated, 1);

  const after = await listNotifications(userId, { channel: "web", unreadOnly: true, limit: 10 });
  assert.equal(after.length, 0);
});

test("getNotificationPreferences falls back to web when external channels are not connected", async () => {
  const { getNotificationPreferences } = await import("./notificationService.js");
  const userId = "stale-channel-user";

  await writeJson(path.join(process.env["USERS_DIR"]!, userId, "profile.json"), {
    notifications: {
      primaryChannel: "telegram",
      enabledChannels: {
        telegram: true,
        web: true,
        whatsapp: true,
      },
      categories: {
        dailyBriefs: true,
        reportRuns: true,
        marketNews: true,
      },
    },
  });

  const preferences = await getNotificationPreferences(userId);
  assert.equal(preferences.primaryChannel, "web");
  assert.equal(preferences.enabledChannels.web, true);
  assert.equal(preferences.enabledChannels.telegram, false);
  assert.equal(preferences.enabledChannels.whatsapp, false);
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

    await writeJson(path.join(process.env["USERS_DIR"]!, userId, "profile.json"), {
      notifications: {
        primaryChannel: "whatsapp",
        enabledChannels: {
          telegram: false,
          web: false,
          whatsapp: true,
        },
        categories: {
          dailyBriefs: true,
          reportRuns: true,
          marketNews: true,
        },
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
      category: "report",
      title: "Deep dive complete",
      body: "AAPL report is ready.",
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

    const items = await listNotifications(userId, { channel: "whatsapp", limit: 10 });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.delivered, true);
    assert.equal(items[0]?.error, null);
  } finally {
    global.fetch = originalFetch;
  }
});
