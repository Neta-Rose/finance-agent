import { z } from "zod";
import { randomUUID } from "crypto";
import type { ToolDefinition, ToolContext } from "./registry.js";
import { getPrice, getUsdIlsRate } from "../../priceService.js";
import { PortfolioFileSchema } from "../../../schemas/portfolio.js";
import { promises as fs } from "fs";
import { resolveConfiguredPath } from "../../paths.js";
import path from "path";

/**
 * Read tools — Phase 5, task 5.5.
 *
 * Spec: design.md §8.1; E1.1–E1.4.
 *
 * All read tools:
 * - Record a `tool_calls` row with `category='read'` and `cost_points=0` (E1.2).
 * - Validate input with Zod; malformed args produce a structured error (E1.4).
 * - Never charge points.
 */

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeToolCallAudit(
  ctx: ToolContext,
  toolName: string,
  argsJson: Record<string, unknown>,
  resultStatus: "success" | "error" | "rejected",
  latencyMs: number,
  auditNote?: string
): Promise<void> {
  if (!ctx.db) return;
  try {
    await ctx.db.query(
      `INSERT INTO tool_calls
         (id, conversation_id, turn_index, tool_name, category, args_json,
          result_status, result_latency_ms, cost_points, audit_note, occurred_at)
       VALUES ($1, $2, $3, $4, 'read', $5::jsonb, $6, $7, 0, $8, NOW())`,
      [
        randomUUID(),
        ctx.conversationId,
        ctx.turnIndex,
        toolName,
        JSON.stringify(argsJson),
        resultStatus,
        latencyMs,
        auditNote ?? null,
      ]
    );
  } catch {
    // Audit failure must never break the tool call.
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export function buildReadTools(_ctx: ToolContext): ToolDefinition[] {
  return [

    // ── getPortfolio ────────────────────────────────────────────────────────
    {
      name: "getPortfolio",
      category: "read",
      description: "Returns the user's current portfolio with live prices, P/L, and weights.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (_args, toolCtx) => {
        const t0 = Date.now();
        try {
          const portfolioPath = path.join(USERS_DIR, toolCtx.userId, "data", "portfolio.json");
          const raw = await fs.readFile(portfolioPath, "utf-8");
          const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
          const usdIlsRate = await getUsdIlsRate();
          const allPositions = Object.entries(portfolio.accounts).flatMap(([account, positions]) =>
            positions.map((p) => ({ account, ...p }))
          );
          const priceResults = await Promise.allSettled(
            allPositions.map((p) => getPrice(p.ticker, p.exchange, usdIlsRate))
          );
          let totalILS = 0;
          const positions = allPositions.map((p, i) => {
            const pr = priceResults[i];
            const liveILS = pr?.status === "fulfilled" ? pr.value.priceILS : null;
            const shares = p.shares;
            const valueILS = liveILS !== null ? liveILS * shares : null;
            if (valueILS !== null) totalILS += valueILS;
            const costILS = p.exchange === "TASE"
              ? p.unitAvgBuyPrice * shares
              : p.unitAvgBuyPrice * usdIlsRate * shares;
            const plILS = valueILS !== null ? valueILS - costILS : null;
            const plPct = plILS !== null && costILS > 0 ? (plILS / costILS) * 100 : null;
            return {
              ticker: p.ticker,
              exchange: p.exchange,
              account: p.account,
              shares,
              liveILS,
              valueILS,
              plILS,
              plPct: plPct !== null ? Math.round(plPct * 100) / 100 : null,
            };
          });
          const withWeights = positions.map((p) => ({
            ...p,
            weightPct: totalILS > 0 && p.valueILS !== null
              ? Math.round((p.valueILS / totalILS) * 10000) / 100
              : null,
          }));
          await writeToolCallAudit(toolCtx, "getPortfolio", {}, "success", Date.now() - t0);
          return { status: "success", data: { totalILS: Math.round(totalILS * 100) / 100, usdIlsRate, positions: withWeights } };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getPortfolio", {}, "error", Date.now() - t0);
          return { status: "error", error: `portfolio_unavailable: ${(err as Error).message.slice(0, 200)}` };
        }
      },
    },

    // ── getStrategy ─────────────────────────────────────────────────────────
    {
      name: "getStrategy",
      category: "read",
      description: "Returns the full strategy for a specific ticker.",
      inputSchema: {
        type: "object",
        properties: { ticker: { type: "string", pattern: "^[A-Z0-9.]{1,12}$" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({ ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/) }).safeParse(args);
        if (!parsed.success) {
          await writeToolCallAudit(toolCtx, "getStrategy", args as Record<string, unknown>, "error", Date.now() - t0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const record = await toolCtx.strategyStore.readStrategy(toolCtx.userId, parsed.data.ticker);
          if (!record) {
            await writeToolCallAudit(toolCtx, "getStrategy", parsed.data, "error", Date.now() - t0);
            return { status: "error", error: "strategy_not_found" };
          }
          await writeToolCallAudit(toolCtx, "getStrategy", parsed.data, "success", Date.now() - t0);
          return { status: "success", data: record };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getStrategy", parsed.data, "error", Date.now() - t0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── getStrategies ────────────────────────────────────────────────────────
    {
      name: "getStrategies",
      category: "read",
      description: "Returns all strategies for the user, optionally filtered by scope.",
      inputSchema: {
        type: "object",
        properties: { scope: { type: "string", enum: ["portfolio", "tracking", "all"] } },
        additionalProperties: false,
      },
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({ scope: z.enum(["portfolio", "tracking", "all"]).optional() }).safeParse(args);
        if (!parsed.success) {
          await writeToolCallAudit(toolCtx, "getStrategies", args as Record<string, unknown>, "error", Date.now() - t0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const scope = parsed.data.scope === "all" ? undefined : parsed.data.scope;
          const strategies = await toolCtx.strategyStore.listStrategies(toolCtx.userId, scope ? { assetScope: scope } : undefined);
          await writeToolCallAudit(toolCtx, "getStrategies", parsed.data, "success", Date.now() - t0);
          return { status: "success", data: { strategies } };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getStrategies", parsed.data, "error", Date.now() - t0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── getRecentReports ─────────────────────────────────────────────────────
    {
      name: "getRecentReports",
      category: "read",
      description: "Returns recent report batches for the user.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({
          ticker: z.string().optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }).safeParse(args);
        if (!parsed.success) {
          await writeToolCallAudit(toolCtx, "getRecentReports", args as Record<string, unknown>, "error", Date.now() - t0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const batches = await toolCtx.reportIndexStore.listReportBatches(toolCtx.userId, { limit: parsed.data.limit ?? 10 });
          await writeToolCallAudit(toolCtx, "getRecentReports", parsed.data, "success", Date.now() - t0);
          return { status: "success", data: { reports: batches } };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getRecentReports", parsed.data, "error", Date.now() - t0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── getCatalystsDueSoon ──────────────────────────────────────────────────
    {
      name: "getCatalystsDueSoon",
      category: "read",
      description: "Returns catalysts expiring within the next N days across all strategies.",
      inputSchema: {
        type: "object",
        properties: { days: { type: "integer", minimum: 1, maximum: 60 } },
        additionalProperties: false,
      },
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({ days: z.number().int().min(1).max(60).optional() }).safeParse(args);
        if (!parsed.success) {
          await writeToolCallAudit(toolCtx, "getCatalystsDueSoon", args as Record<string, unknown>, "error", Date.now() - t0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const days = parsed.data.days ?? 14;
          const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
          const strategies = await toolCtx.strategyStore.listStrategies(toolCtx.userId);
          const catalysts: Array<{ ticker: string; description: string; expiresAt: string; daysUntil: number; triggered: boolean }> = [];
          for (const s of strategies) {
            for (const c of s.catalysts) {
              if (!c.expiresAt || c.triggered) continue;
              const exp = new Date(c.expiresAt);
              if (exp <= cutoff) {
                catalysts.push({
                  ticker: s.ticker,
                  description: c.description,
                  expiresAt: c.expiresAt,
                  daysUntil: Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
                  triggered: c.triggered,
                });
              }
            }
          }
          catalysts.sort((a, b) => a.daysUntil - b.daysUntil);
          await writeToolCallAudit(toolCtx, "getCatalystsDueSoon", parsed.data, "success", Date.now() - t0);
          return { status: "success", data: { catalysts } };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getCatalystsDueSoon", parsed.data, "error", Date.now() - t0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── getEscalationHistory ─────────────────────────────────────────────────
    {
      name: "getEscalationHistory",
      category: "read",
      description: "Returns escalation history for a ticker or all tickers.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({
          ticker: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }).safeParse(args);
        if (!parsed.success) {
          await writeToolCallAudit(toolCtx, "getEscalationHistory", args as Record<string, unknown>, "error", Date.now() - t0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const history = await toolCtx.escalationHistoryStore.listEscalationHistory(toolCtx.userId, {
            ...(parsed.data.ticker ? { ticker: parsed.data.ticker } : {}),
            limit: parsed.data.limit ?? 50,
          });
          await writeToolCallAudit(toolCtx, "getEscalationHistory", parsed.data, "success", Date.now() - t0);
          return { status: "success", data: { history } };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getEscalationHistory", parsed.data, "error", Date.now() - t0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── getRiskSummary ───────────────────────────────────────────────────────
    {
      name: "getRiskSummary",
      category: "read",
      description: "Returns the latest portfolio-level risk snapshot (concentration, largest position).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async (_args, toolCtx) => {
        const t0 = Date.now();
        try {
          const snapshot = await toolCtx.portfolioRiskStore.getLatestPortfolioRiskSnapshot(toolCtx.userId);
          await writeToolCallAudit(toolCtx, "getRiskSummary", {}, "success", Date.now() - t0);
          return { status: "success", data: snapshot ?? { message: "No risk snapshot available yet. Run a full report first." } };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getRiskSummary", {}, "error", Date.now() - t0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── getNotifications ─────────────────────────────────────────────────────
    {
      name: "getNotifications",
      category: "read",
      description: "Returns recent notifications for the user.",
      inputSchema: {
        type: "object",
        properties: {
          unreadOnly: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({
          unreadOnly: z.boolean().optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }).safeParse(args);
        if (!parsed.success) {
          await writeToolCallAudit(toolCtx, "getNotifications", args as Record<string, unknown>, "error", Date.now() - t0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const notifications = await toolCtx.notificationStore.listNotifications(toolCtx.userId, {
            ...(parsed.data.unreadOnly !== undefined ? { unreadOnly: parsed.data.unreadOnly } : {}),
            limit: parsed.data.limit ?? 20,
          });
          await writeToolCallAudit(toolCtx, "getNotifications", parsed.data, "success", Date.now() - t0);
          return { status: "success", data: { notifications } };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getNotifications", parsed.data, "error", Date.now() - t0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── searchWeb ────────────────────────────────────────────────────────────
    {
      name: "searchWeb",
      category: "read",
      description: "Searches the web for current information about a ticker or topic. Returns snippets only.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 256 },
          limit: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({
          query: z.string().min(1).max(256),
          limit: z.number().int().min(1).max(8).optional(),
        }).safeParse(args);
        if (!parsed.success) {
          await writeToolCallAudit(toolCtx, "searchWeb", args as Record<string, unknown>, "error", Date.now() - t0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const { searchExaCached } = await import("../../exaService.js");
          const maxResults = Math.min(parsed.data.limit ?? 4, 8);
          const raw = await searchExaCached(parsed.data.query, maxResults);
          // Return snippet-form only (E1.3). Wrap in UNTRUSTED block (O8.1).
          const results = Array.isArray(raw) ? (raw as unknown as Record<string, unknown>[]).map((item) => ({
            title: typeof item["title"] === "string" ? item["title"] : "",
            url: typeof item["url"] === "string" ? item["url"] : "",
            snippet: `<UNTRUSTED kind="web_search">\n${typeof item["text"] === "string" ? item["text"].slice(0, 400) : ""}\n</UNTRUSTED>`,
            publishedDate: typeof item["publishedDate"] === "string" ? item["publishedDate"] : null,
          })) : [];
          await writeToolCallAudit(toolCtx, "searchWeb", parsed.data, "success", Date.now() - t0);
          return { status: "success", data: { results } };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "searchWeb", parsed.data, "error", Date.now() - t0);
          return { status: "error", error: `search_failed: ${(err as Error).message.slice(0, 200)}` };
        }
      },
    },

  ];
}
