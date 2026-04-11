// backend/src/routes/llmProxy.ts
//
// LLM proxy router mounted at /llm/v1.
// Each OpenClaw agent authenticates with its per-user proxy API key.
// The proxy: identifies the user, fingerprints the analyst, correlates with
// the active job, forwards to OpenRouter, and logs every request to SQLite.
//
// Design principles:
//  - Logging NEVER crashes the proxy (all eventStore calls are fire-and-forget)
//  - Streaming responses are piped through immediately (no buffering)
//  - Non-streaming responses are buffered to extract token counts for cost tracking
//  - The passthrough route handles /models, /embeddings, etc. with auth check only
//  - Both OpenAI (Authorization: Bearer) and Anthropic (x-api-key) auth are accepted
//  - POST /messages (Anthropic format) is converted to /chat/completions for OpenRouter

import { Router, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  resolveUserId,
  fingerprintAnalyst,
  getActiveJob,
  estimateCost,
  OPENROUTER_BASE,
} from "../services/llmProxy.js";
import { eventStore } from "../services/eventStore.js";
import { logger } from "../services/logger.js";
import { getSystemControl, getUserControl } from "../services/controlService.js";

const OPENROUTER_KEY = process.env["OPENROUTER_API_KEY"] ?? "";
const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Hop-by-hop headers must not be forwarded to the client
const HOP_BY_HOP = new Set([
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
]);

const router = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────
// OpenClaw sends the proxy API key via either:
//   Authorization: Bearer <key>   (OpenAI-format sessions)
//   x-api-key: <key>              (Anthropic-format sessions)

function extractProxyKey(req: Request): string {
  const bearer = String(req.headers["authorization"] ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (bearer) return bearer;
  return String(req.headers["x-api-key"] ?? "").trim();
}

// ── Anthropic ↔ OpenAI format conversion ─────────────────────────────────────

interface AnthropicMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

interface AnthropicRequestBody {
  model?: string;
  system?: string;
  messages?: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  [key: string]: unknown;
}

function anthropicToOpenAI(body: AnthropicRequestBody): Record<string, unknown> {
  const { model, system, messages = [], max_tokens, temperature, stream, ...rest } = body;

  const openAIMessages: Array<{ role: string; content: string }> = [];

  if (system) {
    openAIMessages.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
    }
    openAIMessages.push({ role: msg.role, content });
  }

  return {
    ...rest,
    model,
    messages: openAIMessages,
    ...(max_tokens !== undefined ? { max_tokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(stream !== undefined ? { stream } : {}),
  };
}

interface OpenAIResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function openAIToAnthropic(openAI: OpenAIResponse, originalModel: string): Record<string, unknown> {
  const choice = openAI.choices?.[0];
  const content = choice?.message?.content ?? "";
  const stopReason = choice?.finish_reason === "stop" ? "end_turn" : "max_tokens";
  return {
    id: (openAI.id ?? "msg_proxy").replace("chatcmpl-", "msg_"),
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: content }],
    model: openAI.model ?? originalModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openAI.usage?.prompt_tokens ?? 0,
      output_tokens: openAI.usage?.completion_tokens ?? 0,
    },
  };
}

// Convert OpenAI SSE stream → Anthropic SSE stream
// This converts chunks like: data: {"choices":[{"delta":{"content":"..."}}]}
// To the Anthropic streaming format OpenClaw expects
function convertStreamToAnthropic(
  openAIStream: globalThis.ReadableStream<Uint8Array>,
  model: string
): Readable {
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let headerSent = false;
  let blockStartSent = false;

  const passthrough = new Readable({ read() {} });

  const sendEvent = (event: string, data: string) => {
    passthrough.push(`event: ${event}\ndata: ${data}\n\n`);
  };

  const nodeStream = Readable.fromWeb(
    openAIStream as Parameters<typeof Readable.fromWeb>[0]
  );

  nodeStream.on("data", (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") {
        // Send end events
        sendEvent("content_block_stop", JSON.stringify({ type: "content_block_stop", index: 0 }));
        sendEvent("message_delta", JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: outputTokens },
        }));
        sendEvent("message_stop", JSON.stringify({ type: "message_stop" }));
        passthrough.push("data: [DONE]\n\n");
        passthrough.push(null);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as {
          id?: string;
          model?: string;
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        if (!headerSent) {
          sendEvent("message_start", JSON.stringify({
            type: "message_start",
            message: {
              id: (parsed.id ?? "msg_stream").replace("chatcmpl-", "msg_"),
              type: "message",
              role: "assistant",
              content: [],
              model: parsed.model ?? model,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: inputTokens, output_tokens: 0 },
            },
          }));
          headerSent = true;
        }

        if (!blockStartSent) {
          sendEvent("content_block_start", JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          }));
          blockStartSent = true;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          outputTokens++;
          sendEvent("content_block_delta", JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: delta.content },
          }));
        }

        // Capture usage if provided
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? inputTokens;
          outputTokens = parsed.usage.completion_tokens ?? outputTokens;
        }
      } catch { /* skip malformed chunks */ }
    }
  });

  nodeStream.on("end", () => {
    if (!passthrough.destroyed) passthrough.push(null);
  });

  nodeStream.on("error", (err) => {
    passthrough.destroy(err);
  });

  return passthrough;
}

// ── Core proxy logic (shared by /chat/completions and /messages) ──────────────

async function handleCompletion(
  _req: Request,
  res: Response,
  openAIBody: Record<string, unknown>,
  isAnthropic: boolean,
  userId: string
): Promise<void> {
  const startTime = Date.now();
  const modelRaw = String(openAIBody["model"] ?? "unknown");
  const isStreaming = openAIBody["stream"] === true;

  // Fingerprint analyst from system prompt
  const messages = (openAIBody["messages"] as Array<{ role?: string; content?: unknown }>) ?? [];
  const analyst = fingerprintAnalyst(messages);

  // Correlate with active job
  const activeJob = await getActiveJob(userId);

  // Enrich with OpenRouter metadata
  const enrichedBody: Record<string, unknown> = {
    ...openAIBody,
    metadata: {
      user_id: userId,
      purpose: activeJob?.action ?? null,
      ticker: activeJob?.ticker ?? null,
      analyst,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://clawd.app",
        "X-Title": `clawd/${userId}/${activeJob?.action ?? "session"}`,
      },
      body: JSON.stringify(enrichedBody),
    });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeoutErr = (err as Error).name === "AbortError";
    const latencyMs = Date.now() - startTime;
    logger.warn(
      `LLM proxy upstream ${isTimeoutErr ? "timeout" : "error"} for ${userId}: ${(err as Error).message}`
    );
    void eventStore.logRequest({
      userId,
      purpose: activeJob?.action ?? null,
      ticker: activeJob?.ticker ?? null,
      analyst,
      model: modelRaw,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs,
      status: isTimeoutErr ? "timeout" : "error",
      errorMessage: (err as Error).message.slice(0, 500),
      timestamp: new Date().toISOString(),
    }).catch(() => {});
    res.status(isTimeoutErr ? 504 : 502).json({ error: "Upstream request failed" });
    return;
  }
  clearTimeout(timeout);

  const latencyMs = Date.now() - startTime;

  if (isStreaming && upstream.body) {
    // Set Anthropic streaming headers when client expects Anthropic format
    if (isAnthropic) {
      res.setHeader("content-type", "text/event-stream");
    } else {
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
      });
    }
    res.status(200);

    void eventStore.logRequest({
      userId,
      purpose: activeJob?.action ?? null,
      ticker: activeJob?.ticker ?? null,
      analyst,
      model: modelRaw,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs,
      status: upstream.ok ? "success" : "error",
      errorMessage: null,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    if (isAnthropic) {
      const converted = convertStreamToAnthropic(upstream.body, modelRaw);
      converted.pipe(res);
    } else {
      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.pipe(res);
    }
  } else {
    const responseText = await upstream.text();
    let tokensIn = 0;
    let tokensOut = 0;
    let outText = responseText;

    if (isAnthropic && upstream.ok) {
      try {
        const openAIResp = JSON.parse(responseText) as OpenAIResponse;
        tokensIn = openAIResp.usage?.prompt_tokens ?? 0;
        tokensOut = openAIResp.usage?.completion_tokens ?? 0;
        outText = JSON.stringify(openAIToAnthropic(openAIResp, modelRaw));
        res.setHeader("content-type", "application/json");
      } catch { /* if conversion fails, pass through raw */ }
    } else {
      try {
        const json = JSON.parse(responseText) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        tokensIn = json.usage?.prompt_tokens ?? 0;
        tokensOut = json.usage?.completion_tokens ?? 0;
      } catch { /* error body — leave tokens at 0 */ }
    }

    if (!isAnthropic) {
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
      });
    }

    const costUsd = estimateCost(modelRaw, tokensIn, tokensOut);
    void eventStore.logRequest({
      userId,
      purpose: activeJob?.action ?? null,
      ticker: activeJob?.ticker ?? null,
      analyst,
      model: modelRaw,
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs,
      status: upstream.ok ? "success" : "error",
      errorMessage: null,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    res.status(upstream.status).send(outText);
  }
}

// ── POST /llm/v1/chat/completions (OpenAI format) ─────────────────────────────
router.post(
  "/chat/completions",
  (async (req: Request, res: Response) => {
    const proxyKey = extractProxyKey(req);
    const userId = resolveUserId(proxyKey);
    if (!userId) {
      res.status(401).json({ error: "Invalid proxy API key" });
      return;
    }

    const [sysCtrl, userCtrl] = await Promise.all([
      getSystemControl(),
      getUserControl(userId),
    ]);
    if (sysCtrl.locked) {
      res.status(503).json({ error: "system_locked", message: sysCtrl.lockReason || "System is temporarily unavailable." });
      return;
    }
    if (userCtrl.restriction === "suspended" || userCtrl.restriction === "blocked" || userCtrl.restriction === "readonly") {
      res.status(403).json({ error: "user_restricted", restriction: userCtrl.restriction, message: userCtrl.reason || "Account restricted." });
      return;
    }

    await handleCompletion(req, res, req.body as Record<string, unknown>, false, userId);
  }) as (req: Request, res: Response) => Promise<void>
);

// ── POST /llm/v1/messages (Anthropic format → converted to OpenAI for OpenRouter)
router.post(
  "/messages",
  (async (req: Request, res: Response) => {
    const proxyKey = extractProxyKey(req);
    const userId = resolveUserId(proxyKey);
    if (!userId) {
      res.status(401).json({ error: "Invalid proxy API key" });
      return;
    }

    const [sysCtrl, userCtrl] = await Promise.all([
      getSystemControl(),
      getUserControl(userId),
    ]);
    if (sysCtrl.locked) {
      res.status(503).json({ error: "system_locked", message: sysCtrl.lockReason || "System is temporarily unavailable." });
      return;
    }
    if (userCtrl.restriction === "suspended" || userCtrl.restriction === "blocked" || userCtrl.restriction === "readonly") {
      res.status(403).json({ error: "user_restricted", restriction: userCtrl.restriction, message: userCtrl.reason || "Account restricted." });
      return;
    }

    const anthropicBody = req.body as AnthropicRequestBody;
    const openAIBody = anthropicToOpenAI(anthropicBody);

    logger.info(`LLM proxy /messages (Anthropic→OpenAI) for ${userId} model=${anthropicBody.model ?? "unknown"}`);

    await handleCompletion(req, res, openAIBody, true, userId);
  }) as (req: Request, res: Response) => Promise<void>
);

// ── Passthrough: /llm/v1/* (models list, embeddings, etc.) ───────────────────
// Auth check only — no logging for non-completion routes.
router.all(
  "/{*path}",
  (async (req: Request, res: Response) => {
    const proxyKey = extractProxyKey(req);
    if (!resolveUserId(proxyKey)) {
      res.status(401).json({ error: "Invalid proxy API key" });
      return;
    }

    const passthroughInit: RequestInit = {
      method: req.method,
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
      },
    };
    if (!["GET", "HEAD"].includes(req.method)) {
      passthroughInit.body = JSON.stringify(req.body as unknown);
    }
    const upstreamRes = await fetch(
      `${OPENROUTER_BASE}${req.path}`,
      passthroughInit
    );

    const text = await upstreamRes.text();
    res.status(upstreamRes.status).send(text);
  }) as (req: Request, res: Response) => Promise<void>
);

export default router;
