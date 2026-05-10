import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TELEGRAM_CHUNKS,
  SAFE_TELEGRAM_CHUNK_LENGTH,
  redactTelegramError,
  sendTelegramMessage,
  splitTelegramText,
} from "./telegramDelivery.js";

test("splitTelegramText removes control characters and preserves Markdown as plain text", () => {
  const text = "*Buy* _AAPL_ [link](https://example.com)\u0000\u0007 `code`";

  const chunks = splitTelegramText(text);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], "*Buy* _AAPL_ [link](https://example.com)   `code`");
});

test("splitTelegramText chunks long text at safe boundaries without exceeding the Telegram limit", () => {
  const paragraph = "AAPL daily brief line with enough words to split sensibly. ";
  const text = paragraph.repeat(220);

  const chunks = splitTelegramText(text);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.length <= MAX_TELEGRAM_CHUNKS);
  assert.ok(chunks.every((chunk) => chunk.length <= SAFE_TELEGRAM_CHUNK_LENGTH));
  assert.match(chunks.join(" "), /AAPL daily brief/);
});

test("splitTelegramText handles empty and boundary-length text", () => {
  assert.deepEqual(splitTelegramText(""), [" "]);

  const exact = "x".repeat(SAFE_TELEGRAM_CHUNK_LENGTH);
  assert.deepEqual(splitTelegramText(exact), [exact]);

  const justOver = `${exact}y`;
  const chunks = splitTelegramText(justOver);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.length, SAFE_TELEGRAM_CHUNK_LENGTH);
  assert.equal(chunks[1], "y");
});

test("sendTelegramMessage sends plain text chunks with previews disabled", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const result = await sendTelegramMessage({
    botToken: "123456:secret-token",
    chatId: "chat-1",
    text: "hello".repeat(SAFE_TELEGRAM_CHUNK_LENGTH),
    fetchImpl,
  });

  assert.equal(result.delivered, true);
  assert.equal(result.error, null);
  assert.equal(result.attemptedChunks, MAX_TELEGRAM_CHUNKS);
  assert.equal(requests.length, MAX_TELEGRAM_CHUNKS);
  assert.ok(requests.every((request) => request.url === "https://api.telegram.org/bot123456:secret-token/sendMessage"));
  assert.ok(requests.every((request) => request.body["parse_mode"] === undefined));
  assert.ok(requests.every((request) => request.body["disable_web_page_preview"] === true));
  assert.ok(requests.every((request) => String(request.body["text"]).length <= SAFE_TELEGRAM_CHUNK_LENGTH));
});

test("sendTelegramMessage records redacted non-2xx Telegram responses without throwing", async () => {
  const token = "987654:super-secret-token";
  const fetchImpl = (async () =>
    new Response(`bad token ${token} https://api.telegram.org/bot${token}/sendMessage`, {
      status: 400,
    })) as typeof fetch;

  const result = await sendTelegramMessage({
    botToken: token,
    chatId: "chat-1",
    text: "hello",
    fetchImpl,
  });

  assert.equal(result.delivered, false);
  assert.equal(result.successfulChunks, 0);
  assert.match(result.error ?? "", /telegram http 400/);
  assert.doesNotMatch(result.error ?? "", /super-secret-token/);
  assert.doesNotMatch(result.error ?? "", /bot987654:super-secret-token/);
  assert.ok((result.error ?? "").length <= 180);
});

test("sendTelegramMessage records redacted network errors and stops after the failed chunk", async () => {
  const token = "123456:network-secret";
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new Error(`network timeout calling https://api.telegram.org/bot${token}/sendMessage`);
  }) as typeof fetch;

  const result = await sendTelegramMessage({
    botToken: token,
    chatId: "chat-1",
    text: "hello".repeat(SAFE_TELEGRAM_CHUNK_LENGTH),
    fetchImpl,
  });

  assert.equal(result.delivered, false);
  assert.equal(result.attemptedChunks, 1);
  assert.equal(result.successfulChunks, 0);
  assert.equal(calls, 1);
  assert.match(result.error ?? "", /network timeout/);
  assert.doesNotMatch(result.error ?? "", /network-secret/);
});

test("redactTelegramError handles non-string bodies and token-bearing URLs", () => {
  const redacted = redactTelegramError({
    description: "failed https://api.telegram.org/bot111:secret/sendMessage Bearer abc",
  });

  assert.match(redacted, /api\.telegram\.org\/<redacted>/);
  assert.match(redacted, /Bearer <redacted>/);
  assert.doesNotMatch(redacted, /111:secret/);
});
