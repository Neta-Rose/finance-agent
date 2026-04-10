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

// ── POST /llm/v1/chat/completions ─────────────────────────────────────────────
router.post(
  "/chat/completions",
  (async (req: Request, res: Response) => {
    const startTime = Date.now();

    // 1. Authenticate: proxy key → userId
    const authHeader = String(req.headers["authorization"] ?? "");
    const proxyKey = authHeader.replace(/^Bearer\s+/i, "").trim();
    const userId = resolveUserId(proxyKey);
    if (!userId) {
      res.status(401).json({ error: "Invalid proxy API key" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const modelRaw = String(body["model"] ?? "unknown");
    const isStreaming = body["stream"] === true;

    // 2. Fingerprint analyst from system prompt
    const messages =
      (body["messages"] as Array<{ role: string; content: string }>) ?? [];
    const systemMsg = messages.find((m) => m.role === "system");
    const analyst = systemMsg
      ? fingerprintAnalyst(systemMsg.content)
      : "orchestrator";

    // 3. Correlate with active job for purpose + ticker tagging
    const activeJob = await getActiveJob(userId);

    // 4. Enrich request body with OpenRouter metadata
    const enrichedBody: Record<string, unknown> = {
      ...body,
      metadata: {
        user_id: userId,
        purpose: activeJob?.action ?? null,
        ticker: activeJob?.ticker ?? null,
        analyst,
      },
    };

    // 5. Forward to OpenRouter with timeout
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
      const isTimeout = (err as Error).name === "AbortError";
      const latencyMs = Date.now() - startTime;
      logger.warn(
        `LLM proxy upstream ${isTimeout ? "timeout" : "error"} for ${userId}: ${(err as Error).message}`
      );
      void eventStore
        .logRequest({
          userId,
          purpose: activeJob?.action ?? null,
          ticker: activeJob?.ticker ?? null,
          analyst,
          model: modelRaw,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencyMs,
          status: isTimeout ? "timeout" : "error",
          errorMessage: (err as Error).message.slice(0, 500),
          timestamp: new Date().toISOString(),
        })
        .catch(() => {});
      res
        .status(isTimeout ? 504 : 502)
        .json({ error: "Upstream request failed" });
      return;
    }
    clearTimeout(timeout);

    // 6. Forward safe upstream headers to client
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.status(upstream.status);

    const latencyMs = Date.now() - startTime;

    if (isStreaming && upstream.body) {
      // Streaming: pipe SSE through immediately.
      // Token counts unavailable without buffering — log with 0 tokens.
      void eventStore
        .logRequest({
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
        })
        .catch(() => {});

      const nodeStream = Readable.fromWeb(
        upstream.body as Parameters<typeof Readable.fromWeb>[0]
      );
      nodeStream.pipe(res);
    } else {
      // Non-streaming: buffer to extract token usage for accurate cost tracking
      const responseText = await upstream.text();
      let tokensIn = 0;
      let tokensOut = 0;
      try {
        const json = JSON.parse(responseText) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        tokensIn = json.usage?.prompt_tokens ?? 0;
        tokensOut = json.usage?.completion_tokens ?? 0;
      } catch {
        /* error body or non-JSON — leave tokens at 0 */
      }

      const costUsd = estimateCost(modelRaw, tokensIn, tokensOut);

      void eventStore
        .logRequest({
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
        })
        .catch(() => {});

      res.send(responseText);
    }
  }) as (req: Request, res: Response) => Promise<void>
);

// ── Passthrough: /llm/v1/* (models list, embeddings, etc.) ───────────────────
// Auth check only — no logging for non-completion routes.
router.all(
  "/*",
  (async (req: Request, res: Response) => {
    const authHeader = String(req.headers["authorization"] ?? "");
    const proxyKey = authHeader.replace(/^Bearer\s+/i, "").trim();
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
