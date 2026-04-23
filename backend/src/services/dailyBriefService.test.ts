import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { UserWorkspace } from "../middleware/userIsolation.js";
import type { QuickCheckOutcome } from "./quickCheckService.js";

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daily-brief-service-"));
const usersDir = path.join(testRoot, "users");
process.env["USERS_DIR"] = usersDir;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function setupWorkspace(userId: string, plan?: "low" | "pro"): Promise<{
  ws: UserWorkspace;
  getDailyBriefCoverageLimit: typeof import("./dailyBriefService.js")["getDailyBriefCoverageLimit"];
}> {
  const [{ buildWorkspace }, dailyBriefService] = await Promise.all([
    import("../middleware/userIsolation.js"),
    import("./dailyBriefService.js"),
  ]);

  const ws = buildWorkspace(userId, usersDir);
  await fs.mkdir(ws.jobsDir, { recursive: true });
  await fs.mkdir(path.dirname(ws.configFile), { recursive: true });
  await writeJson(ws.configFile, {
    modelProfile: "testing",
    ...(plan ? { plan } : {}),
  });

  return {
    ws,
    getDailyBriefCoverageLimit: dailyBriefService.getDailyBriefCoverageLimit,
  };
}

function quickCheck(
  ticker: string,
  baselineTrust: QuickCheckOutcome["baseline_trust"],
  needsEscalation = false,
  escalationReason: string | null = null
): QuickCheckOutcome {
  return {
    ticker,
    timestamp: new Date().toISOString(),
    baseline_trust: baselineTrust,
    verdict: needsEscalation ? "REDUCE" : "HOLD",
    confidence: "medium",
    sentiment_score: null,
    catalyst_triggered: false,
    unexpected_event: false,
    needs_escalation: needsEscalation,
    escalation_reason: escalationReason,
    escalated_to_job_id: null,
    used_briefing: false,
    score: needsEscalation ? 45 : 88,
    signals: escalationReason ? [escalationReason] : [],
    strategy_health: [],
    decision: needsEscalation ? "not_safe" : "safe",
    advisor_summary: null,
    advisor_reasons: [],
    used_llm: false,
  };
}

test("daily brief defaults all users to pro coverage", async () => {
  const ctx = await setupWorkspace("daily-brief-default");
  const limit = await ctx.getDailyBriefCoverageLimit(ctx.ws);
  assert.equal(limit, Number.POSITIVE_INFINITY);
});

test("daily brief low plan is capped at 10 positions", async () => {
  const ctx = await setupWorkspace("daily-brief-low", "low");
  const limit = await ctx.getDailyBriefCoverageLimit(ctx.ws);
  assert.equal(limit, 10);
});

test("daily brief truth is coverage_incomplete when monitored coverage is provisional", async () => {
  const { classifyDailyBriefTruth, buildDailyBriefNarrative, buildDailyHighlights } = await import("./dailyBriefService.js");
  const entries = [
    { ticker: "AAPL", currentILS: 10000, quickCheck: quickCheck("AAPL", "provisional") },
    { ticker: "MSFT", currentILS: 9000, quickCheck: quickCheck("MSFT", "valid") },
  ];

  const truth = classifyDailyBriefTruth(entries);
  const baseResult = {
    generatedAt: new Date().toISOString(),
    totalChecked: 2,
    escalated: 0,
    onTrack: 2,
    tickers: entries.map((entry) => ({
      ticker: entry.ticker,
      score: entry.quickCheck.score,
      needsEscalation: entry.quickCheck.needs_escalation,
      escalationReason: entry.quickCheck.escalation_reason,
      verdict: entry.quickCheck.verdict,
      confidence: entry.quickCheck.confidence,
    })),
  };

  const narrative = buildDailyBriefNarrative(baseResult, truth);
  const highlights = buildDailyHighlights(baseResult, truth);

  assert.equal(truth.truthState, "coverage_incomplete");
  assert.equal(narrative.truthState, "coverage_incomplete");
  assert.match(narrative.headline, /Coverage is incomplete/i);
  assert.ok(highlights.includes("Coverage incomplete"));
});

test("daily brief truth is confidence_degraded when coverage is stale but not incomplete", async () => {
  const { classifyDailyBriefTruth, buildDailyBriefNarrative } = await import("./dailyBriefService.js");
  const entries = [
    { ticker: "NVDA", currentILS: 12000, quickCheck: quickCheck("NVDA", "stale") },
    { ticker: "META", currentILS: 7000, quickCheck: quickCheck("META", "valid") },
  ];

  const truth = classifyDailyBriefTruth(entries);
  const baseResult = {
    generatedAt: new Date().toISOString(),
    totalChecked: 2,
    escalated: 0,
    onTrack: 2,
    tickers: entries.map((entry) => ({
      ticker: entry.ticker,
      score: entry.quickCheck.score,
      needsEscalation: entry.quickCheck.needs_escalation,
      escalationReason: entry.quickCheck.escalation_reason,
      verdict: entry.quickCheck.verdict,
      confidence: entry.quickCheck.confidence,
    })),
  };

  const narrative = buildDailyBriefNarrative(baseResult, truth);
  assert.equal(truth.truthState, "confidence_degraded");
  assert.match(narrative.headline, /confidence is degraded/i);
});

test("daily brief truth is action_needed when trusted coverage has active escalations", async () => {
  const { classifyDailyBriefTruth, buildDailyBriefNarrative } = await import("./dailyBriefService.js");
  const entries = [
    {
      ticker: "TSLA",
      currentILS: 15000,
      quickCheck: quickCheck("TSLA", "valid", true, "Live price is below an exit threshold"),
    },
    { ticker: "GOOGL", currentILS: 8000, quickCheck: quickCheck("GOOGL", "valid") },
  ];

  const truth = classifyDailyBriefTruth(entries);
  const baseResult = {
    generatedAt: new Date().toISOString(),
    totalChecked: 2,
    escalated: 1,
    onTrack: 1,
    tickers: entries.map((entry) => ({
      ticker: entry.ticker,
      score: entry.quickCheck.score,
      needsEscalation: entry.quickCheck.needs_escalation,
      escalationReason: entry.quickCheck.escalation_reason,
      verdict: entry.quickCheck.verdict,
      confidence: entry.quickCheck.confidence,
    })),
  };

  const narrative = buildDailyBriefNarrative(baseResult, truth);
  assert.equal(truth.truthState, "action_needed");
  assert.match(narrative.today, /TSLA: Live price is below an exit threshold/i);
});

test("daily brief truth is calm_trusted only when all monitored coverage is valid and no escalations exist", async () => {
  const { classifyDailyBriefTruth, buildDailyBriefNarrative, buildDailyHighlights } = await import("./dailyBriefService.js");
  const entries = [
    { ticker: "BRK.B", currentILS: 10000, quickCheck: quickCheck("BRK.B", "valid") },
    { ticker: "QQQ", currentILS: 9000, quickCheck: quickCheck("QQQ", "valid") },
  ];

  const truth = classifyDailyBriefTruth(entries);
  const baseResult = {
    generatedAt: new Date().toISOString(),
    totalChecked: 2,
    escalated: 0,
    onTrack: 2,
    tickers: entries.map((entry) => ({
      ticker: entry.ticker,
      score: entry.quickCheck.score,
      needsEscalation: entry.quickCheck.needs_escalation,
      escalationReason: entry.quickCheck.escalation_reason,
      verdict: entry.quickCheck.verdict,
      confidence: entry.quickCheck.confidence,
    })),
  };

  const narrative = buildDailyBriefNarrative(baseResult, truth);
  const highlights = buildDailyHighlights(baseResult, truth);

  assert.equal(truth.truthState, "calm_trusted");
  assert.match(narrative.headline, /calm today/i);
  assert.ok(highlights.includes("Calm with trusted coverage"));
});
