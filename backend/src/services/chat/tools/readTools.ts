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
const REPORT_BATCH_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function untrustedReportText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `<UNTRUSTED kind="report_content">\n${trimmed.slice(0, maxChars)}\n</UNTRUSTED>`;
}

function untrustedReportJson(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") return untrustedReportText(value, maxChars);
  if (Array.isArray(value)) return value.map((item) => untrustedReportJson(item, maxChars));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        untrustedReportJson(nested, maxChars),
      ])
    );
  }
  return value;
}

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

    // ── getReportSummary ─────────────────────────────────────────────────────
    {
      name: "getReportSummary",
      category: "read",
      description: "Returns a readable summary of a specific report batch by ID, or the most recent report if no ID is given. Includes mode, date, ticker verdicts, highlights, and key signals.",
      inputSchema: {
        type: "object",
        properties: {
          batchId: { type: "string", description: "Report batch ID. Omit to use the most recent report." },
          ticker: { type: "string", description: "Optional ticker to filter the summary to a single position." },
        },
        additionalProperties: false,
      },
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({
          batchId: z.string().regex(REPORT_BATCH_ID_RE).optional(),
          ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/).optional(),
        }).safeParse(args);
        if (!parsed.success) {
          await writeToolCallAudit(toolCtx, "getReportSummary", args as Record<string, unknown>, "error", Date.now() - t0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          let batchId = parsed.data.batchId;
          // If no batchId given, find the most recent batch
          if (!batchId) {
            const batches = await toolCtx.reportIndexStore.listReportBatches(toolCtx.userId, { limit: 1 });
            if (!batches[0]) {
              await writeToolCallAudit(toolCtx, "getReportSummary", parsed.data, "success", Date.now() - t0);
              return { status: "success", data: { message: "No reports found yet. Run a daily brief or deep dive first." } };
            }
            batchId = batches[0].batchId;
          }

          // Load batch metadata through the user-scoped store method. The fallback
          // keeps older test doubles working while preserving ownership checks.
          let batch: import("../../reportIndexStore.js").ReportBatchRecord | null = null;
          if (toolCtx.reportIndexStore.readReportBatchForUser) {
            batch = await toolCtx.reportIndexStore.readReportBatchForUser(toolCtx.userId, batchId);
          } else {
            const batches = await toolCtx.reportIndexStore.listReportBatches(toolCtx.userId, { limit: 50 });
            batch = batches.find((b) => b.batchId === batchId) ?? null;
          }

          if (!batch) {
            await writeToolCallAudit(toolCtx, "getReportSummary", parsed.data, "error", Date.now() - t0);
            return { status: "error", error: "report_not_found" };
          }

          // Build a readable summary
          const summary: Record<string, unknown> = {
            batchId: batch.batchId,
            mode: batch.mode,
            date: batch.date,
            tickerCount: batch.tickerCount,
          };

          // Include highlights if present
          if (batch.highlights) {
            summary["highlights"] = untrustedReportJson(batch.highlights, 400);
          }

          // Include batch-level summary if present
          if (batch.summary) {
            summary["summary"] = untrustedReportJson(batch.summary, 400);
          }

          // If a ticker filter is requested, include its entry from the index
          if (parsed.data.ticker && toolCtx.db) {
            const rows = await toolCtx.db.query(
              `SELECT ri.ticker, ri.daily_section, ri.entry
                 FROM report_index ri
                 JOIN report_batches rb ON rb.batch_id = ri.batch_id
                WHERE ri.batch_id = $1 AND rb.user_id = $2 AND ri.ticker = $3
                LIMIT 1`,
              [batchId, toolCtx.userId, parsed.data.ticker.toUpperCase()]
            ) as Array<{ ticker: string; daily_section: string | null; entry: Record<string, unknown> }>;
            if (rows[0]) {
              const entry = rows[0].entry;
              // Extract the most readable fields from the entry
              summary["ticker"] = rows[0].ticker;
              summary["dailySection"] = rows[0].daily_section;
              summary["verdict"] = entry["verdict"];
              summary["confidence"] = entry["confidence"];
              summary["reasoning"] = untrustedReportText(entry["reasoning"], 400) ?? entry["reasoning"];
              summary["catalysts"] = untrustedReportJson(entry["catalysts"], 300);
              summary["bullCase"] = untrustedReportText(entry["bullCase"] ?? entry["bull_case"], 300);
              summary["bearCase"] = untrustedReportText(entry["bearCase"] ?? entry["bear_case"], 300);
            } else {
              summary["ticker"] = parsed.data.ticker;
              summary["message"] = `No entry found for ${parsed.data.ticker} in this report.`;
            }
          } else if (toolCtx.db) {
            // Include all ticker verdicts from the index for a full summary
            const rows = await toolCtx.db.query(
              `SELECT ri.ticker,
                      ri.daily_section,
                      ri.entry->>'verdict' as verdict,
                      ri.entry->>'confidence' as confidence,
                      ri.entry->>'reasoning' as reasoning
                 FROM report_index ri
                 JOIN report_batches rb ON rb.batch_id = ri.batch_id
                WHERE ri.batch_id = $1 AND rb.user_id = $2
                ORDER BY ri.ticker ASC`,
              [batchId, toolCtx.userId]
            ) as Array<{ ticker: string; daily_section: string | null; verdict: string; confidence: string; reasoning: string }>;
            summary["entries"] = rows.map((r) => ({
              ticker: r.ticker,
              section: r.daily_section,
              verdict: r.verdict,
              confidence: r.confidence,
              reasoning: untrustedReportText(r.reasoning, 200),
            }));
          }

          await writeToolCallAudit(toolCtx, "getReportSummary", parsed.data, "success", Date.now() - t0);
          return { status: "success", data: summary };
        } catch (err) {
          await writeToolCallAudit(toolCtx, "getReportSummary", parsed.data ?? {}, "error", Date.now() - t0);
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
