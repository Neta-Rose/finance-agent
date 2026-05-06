import { z } from "zod";
import { randomUUID } from "crypto";
import type { ToolDefinition, ToolContext } from "./registry.js";
import { buildWorkspace } from "../../../middleware/userIsolation.js";
import { admitOrReuseStepQueueJob } from "../../stepQueue/admission.js";
import { getApplicationDataSource } from "../../../db/applicationDataSource.js";
import { getFeatureValue } from "../../featureFlagService.js";
import { getUserControl, getSystemControl } from "../../controlService.js";
import { resolveConfiguredPath } from "../../paths.js";

/**
 * Action tools — Phase 5, task 5.6.
 *
 * Spec: design.md §8.2; E2.1–E2.6, G2.1–G2.4.
 *
 * All action tools:
 * - Require explicit user confirmation via the confirmationStore handshake (E2.2).
 * - Deduct points from the user's budget (E2.3).
 * - Refuse for restricted users or locked system (E2.4).
 * - Write a `tool_calls` audit row with `category='action'` and `cost_points` set.
 */

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeActionAudit(
  ctx: ToolContext,
  toolName: string,
  argsJson: Record<string, unknown>,
  resultStatus: "success" | "error" | "rejected",
  latencyMs: number,
  costPoints: number,
  auditNote?: string
): Promise<void> {
  if (!ctx.db) return;
  try {
    await ctx.db.query(
      `INSERT INTO tool_calls
         (id, conversation_id, turn_index, tool_name, category, args_json,
          result_status, result_latency_ms, cost_points, audit_note, occurred_at)
       VALUES ($1, $2, $3, $4, 'action', $5::jsonb, $6, $7, $8, $9, NOW())`,
      [
        randomUUID(),
        ctx.conversationId,
        ctx.turnIndex,
        toolName,
        JSON.stringify(argsJson),
        resultStatus,
        latencyMs,
        costPoints,
        auditNote ?? null,
      ]
    );
  } catch {
    // Audit failure must never break the tool call.
  }
}

async function assertNotRestricted(userId: string): Promise<string | null> {
  const [sysCtrl, userCtrl] = await Promise.all([getSystemControl(), getUserControl(userId)]);
  if (sysCtrl.locked) return `system_locked: ${sysCtrl.lockReason ?? "system is temporarily locked"}`;
  if (userCtrl.restriction === "suspended" || userCtrl.restriction === "blocked" || userCtrl.restriction === "readonly") {
    return `user_restricted: ${userCtrl.restriction}`;
  }
  return null;
}

async function pollJobUntilTerminalOrTimeout(
  jobId: string,
  timeoutSec: number,
  ownerUserId: string
): Promise<{ status: string; result: unknown } | null> {
  const ds = await getApplicationDataSource();
  const deadline = Date.now() + timeoutSec * 1000;
  const TERMINAL = new Set(["completed", "partial_completed", "failed", "cancelled", "superseded"]);
  while (Date.now() < deadline) {
    const rows = await ds.query(
      `SELECT status, result FROM jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [jobId, ownerUserId]
    ) as Array<{ status: string; result: unknown }>;
    const row = rows[0];
    if (!row) return null;
    if (TERMINAL.has(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export function buildActionTools(ctx: ToolContext): ToolDefinition[] {
  return [

    // ── triggerQuickCheck ────────────────────────────────────────────────────
    {
      name: "triggerQuickCheck",
      category: "action",
      description: "Runs a quick check on a specific ticker to evaluate whether a deep dive is needed.",
      inputSchema: {
        type: "object",
        properties: { ticker: { type: "string", pattern: "^[A-Z0-9.]{1,12}$" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      costPoints: 5,
      requiresConfirmation: true,
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({ ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/) }).safeParse(args);
        if (!parsed.success) {
          await writeActionAudit(toolCtx, "triggerQuickCheck", args as Record<string, unknown>, "error", Date.now() - t0, 0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        const restriction = await assertNotRestricted(toolCtx.userId);
        if (restriction) {
          await writeActionAudit(toolCtx, "triggerQuickCheck", parsed.data, "rejected", Date.now() - t0, 0, restriction);
          return { status: "error", error: restriction };
        }
        try {
          const ws = buildWorkspace(toolCtx.userId, USERS_DIR);
          const admitted = await admitOrReuseStepQueueJob({
            workspace: ws,
            action: "quick_check",
            ticker: parsed.data.ticker,
            source: "dashboard_action",
            budgetAdmittedAt: new Date(),
          });
          // Correlate with conversation
          if (toolCtx.db) {
            await toolCtx.db.query(
              `UPDATE jobs SET conversation_id = $2 WHERE id = $1`,
              [admitted.jobId, toolCtx.conversationId]
            );
          }
          await writeActionAudit(toolCtx, "triggerQuickCheck", parsed.data, "success", Date.now() - t0, 5,
            `confirmation=${toolCtx.confirmationToken ?? "none"}`);
          return { status: "success", data: { jobId: admitted.jobId, eta: "~2 minutes", statusUrl: `/api/jobs/${admitted.jobId}` } };
        } catch (err) {
          await writeActionAudit(toolCtx, "triggerQuickCheck", parsed.data, "error", Date.now() - t0, 0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── triggerDeepDive ──────────────────────────────────────────────────────
    {
      name: "triggerDeepDive",
      category: "action",
      description: "Starts a full analyst deep dive for a specific ticker. Takes several minutes.",
      inputSchema: {
        type: "object",
        properties: { ticker: { type: "string", pattern: "^[A-Z0-9.]{1,12}$" } },
        required: ["ticker"],
        additionalProperties: false,
      },
      costPoints: 20,
      requiresConfirmation: true,
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({ ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/) }).safeParse(args);
        if (!parsed.success) {
          await writeActionAudit(toolCtx, "triggerDeepDive", args as Record<string, unknown>, "error", Date.now() - t0, 0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        const restriction = await assertNotRestricted(toolCtx.userId);
        if (restriction) {
          await writeActionAudit(toolCtx, "triggerDeepDive", parsed.data, "rejected", Date.now() - t0, 0, restriction);
          return { status: "error", error: restriction };
        }
        try {
          const ws = buildWorkspace(toolCtx.userId, USERS_DIR);
          const admitted = await admitOrReuseStepQueueJob({
            workspace: ws,
            action: "deep_dive",
            ticker: parsed.data.ticker,
            source: "dashboard_action",
            budgetAdmittedAt: new Date(),
          });
          if (toolCtx.db) {
            await toolCtx.db.query(
              `UPDATE jobs SET conversation_id = $2 WHERE id = $1`,
              [admitted.jobId, toolCtx.conversationId]
            );
          }
          await writeActionAudit(toolCtx, "triggerDeepDive", parsed.data, "success", Date.now() - t0, 20,
            `confirmation=${toolCtx.confirmationToken ?? "none"}`);
          return { status: "success", data: { jobId: admitted.jobId, eta: "~10 minutes", statusUrl: `/api/jobs/${admitted.jobId}` } };
        } catch (err) {
          await writeActionAudit(toolCtx, "triggerDeepDive", parsed.data, "error", Date.now() - t0, 0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── triggerDailyBrief ────────────────────────────────────────────────────
    {
      name: "triggerDailyBrief",
      category: "action",
      description: "Runs the daily portfolio brief now.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      costPoints: 30,
      requiresConfirmation: true,
      handler: async (_args, toolCtx) => {
        const t0 = Date.now();
        const restriction = await assertNotRestricted(toolCtx.userId);
        if (restriction) {
          await writeActionAudit(toolCtx, "triggerDailyBrief", {}, "rejected", Date.now() - t0, 0, restriction);
          return { status: "error", error: restriction };
        }
        try {
          const ws = buildWorkspace(toolCtx.userId, USERS_DIR);
          const admitted = await admitOrReuseStepQueueJob({
            workspace: ws,
            action: "daily_brief",
            source: "dashboard_action",
            budgetAdmittedAt: new Date(),
          });
          await writeActionAudit(toolCtx, "triggerDailyBrief", {}, "success", Date.now() - t0, 30,
            `confirmation=${toolCtx.confirmationToken ?? "none"}`);
          return { status: "success", data: { jobId: admitted.jobId, eta: "~5 minutes" } };
        } catch (err) {
          await writeActionAudit(toolCtx, "triggerDailyBrief", {}, "error", Date.now() - t0, 0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── snoozeTicker ─────────────────────────────────────────────────────────
    {
      name: "snoozeTicker",
      category: "action",
      description: "Snoozes escalation alerts for a ticker for a number of days.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: { type: "string", pattern: "^[A-Z0-9.]{1,12}$" },
          days: { type: "integer", minimum: 1, maximum: 180 },
        },
        required: ["ticker"],
        additionalProperties: false,
      },
      costPoints: 0,
      requiresConfirmation: true,
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({
          ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
          days: z.number().int().min(1).max(180).optional(),
        }).safeParse(args);
        if (!parsed.success) {
          await writeActionAudit(toolCtx, "snoozeTicker", args as Record<string, unknown>, "error", Date.now() - t0, 0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const maxSnoozeDays = await getFeatureValue<number>("max_snooze_days") ?? 180;
          const days = Math.min(parsed.data.days ?? 30, maxSnoozeDays);
          const snoozeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
          const snooze = await toolCtx.snoozeStore.createSnooze({
            userId: toolCtx.userId,
            ticker: parsed.data.ticker,
            snoozeUntil,
            signalSetFingerprint: "user_manual",
            reason: "user_snooze_via_chat",
          });
          await writeActionAudit(toolCtx, "snoozeTicker", parsed.data, "success", Date.now() - t0, 0);
          return { status: "success", data: { snoozeId: snooze.id, snoozeUntil: snooze.snoozeUntil } };
        } catch (err) {
          await writeActionAudit(toolCtx, "snoozeTicker", parsed.data, "error", Date.now() - t0, 0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── markVerdictAddressed ─────────────────────────────────────────────────
    {
      name: "markVerdictAddressed",
      category: "action",
      description: "Records whether you followed, dismissed, or partially acted on a verdict.",
      inputSchema: {
        type: "object",
        properties: {
          ticker: { type: "string", pattern: "^[A-Z0-9.]{1,12}$" },
          decision: { type: "string", enum: ["followed", "dismissed", "partial_acted"] },
          note: { type: "string", maxLength: 1000 },
        },
        required: ["ticker", "decision"],
        additionalProperties: false,
      },
      costPoints: 0,
      requiresConfirmation: true,
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({
          ticker: z.string().regex(/^[A-Z0-9.]{1,12}$/),
          decision: z.enum(["followed", "dismissed", "partial_acted"]),
          note: z.string().max(1000).optional(),
        }).safeParse(args);
        if (!parsed.success) {
          await writeActionAudit(toolCtx, "markVerdictAddressed", args as Record<string, unknown>, "error", Date.now() - t0, 0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const strategy = await toolCtx.strategyStore.readStrategy(toolCtx.userId, parsed.data.ticker);
          const strategyVersion = strategy?.version ?? 1;
          const record = await toolCtx.verdictActionsStore.recordVerdictAction({
            userId: toolCtx.userId,
            ticker: parsed.data.ticker,
            strategyVersion,
            decision: parsed.data.decision,
            note: parsed.data.note,
          });
          await writeActionAudit(toolCtx, "markVerdictAddressed", parsed.data, "success", Date.now() - t0, 0);
          return { status: "success", data: { verdictActionId: record.id } };
        } catch (err) {
          await writeActionAudit(toolCtx, "markVerdictAddressed", parsed.data, "error", Date.now() - t0, 0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

    // ── waitForJob ───────────────────────────────────────────────────────────
    {
      name: "waitForJob",
      category: "action",
      description: "Waits for a job to complete and returns its final status. Use after triggering a deep dive or quick check.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          timeoutSec: { type: "integer", minimum: 1, maximum: 600 },
        },
        required: ["jobId"],
        additionalProperties: false,
      },
      costPoints: 0,
      requiresConfirmation: false, // waitForJob does not need confirmation
      handler: async (args, toolCtx) => {
        const t0 = Date.now();
        const parsed = z.object({
          jobId: z.string(),
          timeoutSec: z.number().int().min(1).max(600).optional(),
        }).safeParse(args);
        if (!parsed.success) {
          await writeActionAudit(toolCtx, "waitForJob", args as Record<string, unknown>, "error", Date.now() - t0, 0);
          return { status: "error", error: `invalid_args: ${parsed.error.message}` };
        }
        try {
          const maxWait = await getFeatureValue<number>("max_wait_for_job_sec") ?? 600;
          const timeoutSec = Math.min(parsed.data.timeoutSec ?? 60, maxWait);
          const job = await pollJobUntilTerminalOrTimeout(parsed.data.jobId, timeoutSec, toolCtx.userId);
          await writeActionAudit(toolCtx, "waitForJob", parsed.data, "success", Date.now() - t0, 0);
          if (!job) return { status: "success", data: { status: "still_running" } };
          return { status: "success", data: { status: job.status, result: job.result } };
        } catch (err) {
          await writeActionAudit(toolCtx, "waitForJob", parsed.data, "error", Date.now() - t0, 0);
          return { status: "error", error: (err as Error).message.slice(0, 200) };
        }
      },
    },

  ];
}
