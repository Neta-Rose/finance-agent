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
  hasPendingTriggerFiles,
  resolveProxyMetadata,
  shouldAllowProxyRequest,
  OPENROUTER_BASE,
  toUpstreamModel,
} from "../services/llmProxy.js";
import { eventStore } from "../services/eventStore.js";
import { logger } from "../services/logger.js";
import { getSystemControl, getUserControl } from "../services/controlService.js";
import { ensurePointsBudgetAvailable } from "../services/pointsBudgetService.js";
import { buildWorkspace } from "../middleware/userIsolation.js";
import { getJob, updateJob } from "../services/jobService.js";
import { markDeepDiveJobPaused } from "../services/deepDiveService.js";
import { resolveConfiguredPath } from "../services/paths.js";
import { isBudgetAdmittedJob } from "../services/jobAdmissionService.js";

const OPENROUTER_KEY = process.env["OPENROUTER_API_KEY"] ?? "";
const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

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

function safeSnippet(text: string | null | undefined, max = 240): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

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

async function deriveProxyMetadata(
  req: Request,
  userId: string,
  isAnthropic: boolean
): Promise<{
  openAIBody: Record<string, unknown>;
  metadata: ReturnType<typeof resolveProxyMetadata>;
  modelRaw: string;
}> {
  const openAIBody = isAnthropic
    ? anthropicToOpenAI(req.body as AnthropicRequestBody)
    : (req.body as Record<string, unknown>);
  const messages =
    (openAIBody["messages"] as Array<{ role?: string; content?: unknown }>) ?? [];
  const analyst = fingerprintAnalyst(messages);
  const activeJob = await getActiveJob(userId);
  const metadata = resolveProxyMetadata(req.headers, analyst, activeJob, messages);
  const modelRaw = String(openAIBody["model"] ?? "unknown");
  return { openAIBody, metadata, modelRaw };
}

async function logRejectedProxyRequest(params: {
  userId: string;
  metadata: ReturnType<typeof resolveProxyMetadata>;
  modelRaw: string;
  startedAt: number;
  rejectionReason: string;
  errorMessage: string;
}): Promise<void> {
  await eventStore.logRequest({
    userId: params.userId,
    purpose: params.metadata.purpose,
    ticker: params.metadata.ticker,
    jobId: params.metadata.jobId,
    sourceClass: params.metadata.sourceClass,
    analyst: params.metadata.analyst,
    model: params.modelRaw,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    latencyMs: Date.now() - params.startedAt,
    status: "error",
    errorMessage: params.errorMessage,
    attributionSource: params.metadata.attributionSource,
    rejectionReason: params.rejectionReason,
    timestamp: new Date().toISOString(),
  });
}

async function logProxyRequest(params: {
  userId: string;
  metadata: ReturnType<typeof resolveProxyMetadata>;
  modelRaw: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: "success" | "error" | "timeout";
  errorMessage: string | null;
  rejectionReason: string | null;
}): Promise<void> {
  await eventStore.logRequest({
    userId: params.userId,
    purpose: params.metadata.purpose,
    ticker: params.metadata.ticker,
    jobId: params.metadata.jobId,
    sourceClass: params.metadata.sourceClass,
    analyst: params.metadata.analyst,
    model: params.modelRaw,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
    costUsd: params.costUsd,
    latencyMs: params.latencyMs,
    status: params.status,
    errorMessage: params.errorMessage,
    attributionSource: params.metadata.attributionSource,
    rejectionReason: params.rejectionReason,
    timestamp: new Date().toISOString(),
  });
}

async function pauseJobForPointsBudgetExhaustion(
  userId: string,
  metadata: ReturnType<typeof resolveProxyMetadata>
): Promise<void> {
  if (!metadata.jobId) return;

  try {
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await getJob(ws, metadata.jobId);
    const reason = "Daily points budget exhausted during execution";

    if (job.status !== "pending" && job.status !== "running") {
      return;
    }

    if (job.action === "deep_dive") {
      await markDeepDiveJobPaused(ws, job, reason);
      return;
    }

    await updateJob(ws, job.id, {
      status: "paused",
      completed_at: new Date().toISOString(),
      error: reason,
    });
  } catch (err) {
    logger.warn(`Failed to pause job after points budget exhaustion for ${userId}: ${String(err)}`);
  }
}

async function shouldSkipPointsBudgetGate(
  userId: string,
  metadata: ReturnType<typeof resolveProxyMetadata>
): Promise<boolean> {
  if (!metadata.jobId || metadata.sourceClass === "direct_chat") {
    return false;
  }

  try {
    const ws = buildWorkspace(userId, USERS_DIR);
    const job = await getJob(ws, metadata.jobId);
    return job.status === "running" && isBudgetAdmittedJob(job);
  } catch {
    return false;
  }
}

interface OpenAIResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number | string;
  };
}

interface OpenRouterUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number | string;
}

function parseUsageCost(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function extractOpenRouterUsageMetrics(payload: {
  usage?: OpenRouterUsagePayload;
} | null | undefined): {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
} {
  const usage = payload?.usage;
  return {
    tokensIn: usage?.prompt_tokens ?? 0,
    tokensOut: usage?.completion_tokens ?? 0,
    costUsd: parseUsageCost(usage?.cost),
  };
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

export function parseStreamingUsageFromText(text: string): {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  errorMessage: string | null;
} {
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let errorMessage: string | null = null;

  for (const rawLine of text.split("\n")) {
    if (!rawLine.startsWith("data: ")) continue;
    const payload = rawLine.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const parsed = JSON.parse(payload) as {
        usage?: OpenRouterUsagePayload;
        error?: { message?: string };
      };

      if (parsed.usage) {
        const usage = extractOpenRouterUsageMetrics(parsed);
        tokensIn = usage.tokensIn || tokensIn;
        tokensOut = usage.tokensOut || tokensOut;
        costUsd = usage.costUsd || costUsd;
      }

      if (!errorMessage && typeof parsed.error?.message === "string") {
        errorMessage = safeSnippet(parsed.error.message);
      }
    } catch {
      // Ignore malformed SSE chunks while auditing usage.
    }
  }

  if (!errorMessage && !text.includes("data: ")) {
    errorMessage = safeSnippet(text);
  }

  return { tokensIn, tokensOut, costUsd, errorMessage };
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
  const upstreamModel = toUpstreamModel(modelRaw);
  const isStreaming = openAIBody["stream"] === true;

  // Fingerprint analyst from system prompt
  const messages = (openAIBody["messages"] as Array<{ role?: string; content?: unknown }>) ?? [];
  const analyst = fingerprintAnalyst(messages);

  // Correlate with active job
  const activeJob = await getActiveJob(userId);
  const metadata = resolveProxyMetadata(_req.headers, analyst, activeJob, messages);
  const hasPendingTriggers =
    metadata.sourceClass === "unknown_agent_session"
      ? await hasPendingTriggerFiles(userId)
      : false;

  if (!shouldAllowProxyRequest(userId, metadata, hasPendingTriggers)) {
    void logProxyRequest({
      userId,
      metadata,
      modelRaw: upstreamModel,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: Date.now() - startTime,
      status: "error",
      errorMessage: "rejected: no active backend job",
      rejectionReason: "no_active_job",
    }).catch(() => {});
    res.status(409).json({ error: "no_active_job", message: "LLM requests require an active backend job." });
    return;
  }

  if (userId !== "main") {
    const skipBudgetGate = await shouldSkipPointsBudgetGate(userId, metadata);
    if (!skipBudgetGate) {
      const budgetGate = await ensurePointsBudgetAvailable(userId);
      if (!budgetGate.allowed) {
        const latencyMs = Date.now() - startTime;
        void logProxyRequest({
          userId,
          metadata,
          modelRaw: upstreamModel,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencyMs,
          status: "error",
          errorMessage: "rejected: daily points budget exhausted",
          rejectionReason: "points_budget_exhausted",
        }).catch(() => {});
        await pauseJobForPointsBudgetExhaustion(userId, metadata);
        res.status(429).json({
          error: "points_budget_exhausted",
          message: "Daily points budget exhausted. Try again after the budget window resets or contact admin.",
        });
        return;
      }
    }
  }

  // Enrich with OpenRouter metadata
  const enrichedBody: Record<string, unknown> = {
    ...openAIBody,
    model: upstreamModel,
    metadata: {
      user_id: userId,
      purpose: metadata.purpose,
      ticker: metadata.ticker,
      analyst: metadata.analyst,
      job_id: metadata.jobId,
      source_class: metadata.sourceClass,
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
        "X-Title": `clawd/${userId}/${metadata.purpose ?? "session"}`,
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
    void logProxyRequest({
      userId,
      metadata,
      modelRaw: upstreamModel,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs,
      status: isTimeoutErr ? "timeout" : "error",
      errorMessage: (err as Error).message.slice(0, 500),
      rejectionReason: null,
    }).catch(() => {});
    res.status(isTimeoutErr ? 504 : 502).json({ error: "Upstream request failed" });
    return;
  }
  clearTimeout(timeout);

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

    const streamAuditPromise = upstream
      .clone()
      .text()
      .then(parseStreamingUsageFromText)
      .catch(() => ({
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        errorMessage: null,
      }));

    void (async () => {
      const audit = await streamAuditPromise;
      await logProxyRequest({
        userId,
        metadata,
        modelRaw: upstreamModel,
        tokensIn: audit.tokensIn,
        tokensOut: audit.tokensOut,
        costUsd: audit.costUsd,
        latencyMs: Date.now() - startTime,
        status: upstream.ok ? "success" : "error",
        errorMessage: upstream.ok ? null : audit.errorMessage,
        rejectionReason: null,
      });
    })().catch(() => {});

    if (isAnthropic) {
      const converted = convertStreamToAnthropic(upstream.body, upstreamModel);
      converted.pipe(res);
    } else {
      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.pipe(res);
    }
  } else {
    const latencyMs = Date.now() - startTime;
    const responseText = await upstream.text();
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    let outText = responseText;

    if (isAnthropic && upstream.ok) {
      try {
        const openAIResp = JSON.parse(responseText) as OpenAIResponse;
        const usage = extractOpenRouterUsageMetrics(openAIResp);
        tokensIn = usage.tokensIn;
        tokensOut = usage.tokensOut;
        costUsd = usage.costUsd;
        outText = JSON.stringify(openAIToAnthropic(openAIResp, upstreamModel));
        res.setHeader("content-type", "application/json");
      } catch { /* if conversion fails, pass through raw */ }
    } else {
      try {
        const json = JSON.parse(responseText) as { usage?: OpenRouterUsagePayload };
        const usage = extractOpenRouterUsageMetrics(json);
        tokensIn = usage.tokensIn;
        tokensOut = usage.tokensOut;
        costUsd = usage.costUsd;
      } catch { /* error body — leave tokens at 0 */ }
    }

    if (!isAnthropic) {
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
      });
    }

    void logProxyRequest({
      userId,
      metadata,
      modelRaw: upstreamModel,
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs,
      status: upstream.ok ? "success" : "error",
      errorMessage: upstream.ok ? null : safeSnippet(responseText),
      rejectionReason: null,
    }).catch(() => {});

    res.status(upstream.status).send(outText);
  }
}

// ── POST /llm/v1/chat/completions (OpenAI format) ─────────────────────────────
router.post(
  "/chat/completions",
  (async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const proxyKey = extractProxyKey(req);
    const userId = resolveUserId(proxyKey);
    if (!userId) {
      res.status(401).json({ error: "Invalid proxy API key" });
      return;
    }

    const { openAIBody, metadata, modelRaw } = await deriveProxyMetadata(req, userId, false);

    const [sysCtrl, userCtrl] = await Promise.all([
      getSystemControl(),
      getUserControl(userId),
    ]);
    if (sysCtrl.locked) {
      void logRejectedProxyRequest({
        userId,
        metadata,
        modelRaw,
        startedAt,
        rejectionReason: "system_locked",
        errorMessage: sysCtrl.lockReason || "System is temporarily unavailable.",
      }).catch(() => {});
      res.status(503).json({ error: "system_locked", message: sysCtrl.lockReason || "System is temporarily unavailable." });
      return;
    }
    if (userCtrl.restriction === "suspended" || userCtrl.restriction === "blocked" || userCtrl.restriction === "readonly") {
      void logRejectedProxyRequest({
        userId,
        metadata,
        modelRaw,
        startedAt,
        rejectionReason: "user_restricted",
        errorMessage: userCtrl.reason || "Account restricted.",
      }).catch(() => {});
      res.status(403).json({ error: "user_restricted", restriction: userCtrl.restriction, message: userCtrl.reason || "Account restricted." });
      return;
    }

    await handleCompletion(req, res, openAIBody, false, userId);
  }) as (req: Request, res: Response) => Promise<void>
);

// ── POST /llm/v1/messages (Anthropic format → converted to OpenAI for OpenRouter)
router.post(
  "/messages",
  (async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const proxyKey = extractProxyKey(req);
    const userId = resolveUserId(proxyKey);
    if (!userId) {
      res.status(401).json({ error: "Invalid proxy API key" });
      return;
    }

    const { openAIBody, metadata, modelRaw } = await deriveProxyMetadata(req, userId, true);

    const [sysCtrl, userCtrl] = await Promise.all([
      getSystemControl(),
      getUserControl(userId),
    ]);
    if (sysCtrl.locked) {
      void logRejectedProxyRequest({
        userId,
        metadata,
        modelRaw,
        startedAt,
        rejectionReason: "system_locked",
        errorMessage: sysCtrl.lockReason || "System is temporarily unavailable.",
      }).catch(() => {});
      res.status(503).json({ error: "system_locked", message: sysCtrl.lockReason || "System is temporarily unavailable." });
      return;
    }
    if (userCtrl.restriction === "suspended" || userCtrl.restriction === "blocked" || userCtrl.restriction === "readonly") {
      void logRejectedProxyRequest({
        userId,
        metadata,
        modelRaw,
        startedAt,
        rejectionReason: "user_restricted",
        errorMessage: userCtrl.reason || "Account restricted.",
      }).catch(() => {});
      res.status(403).json({ error: "user_restricted", restriction: userCtrl.restriction, message: userCtrl.reason || "Account restricted." });
      return;
    }

    logger.info(`LLM proxy /messages (Anthropic→OpenAI) for ${userId} model=${(req.body as AnthropicRequestBody).model ?? "unknown"}`);

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
