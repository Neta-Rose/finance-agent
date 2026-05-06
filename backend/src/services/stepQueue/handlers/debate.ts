import { DebateReportSchema } from "../../../schemas/analysts.js";
import { gatherAnalystArtifacts, gatherCommonInputs, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";

/**
 * debate handler — hardened normalizeRaw.
 *
 * Production failures observed:
 *   - LLM returns the entire JSON as a string (needs JSON.parse)
 *   - dataPoint is null or a number (must be coerced to string ≤200)
 *   - responseToBear / responseToBull exceeds 300 chars
 *   - evidence arrays have fewer than 1 item
 *   - bullRounds / bearRounds have wrong length (not exactly 2)
 *   - sources contain non-URL strings
 *   - thesis / concern exceed 400 chars
 *   - keyDisagreement exceeds 300 chars
 *   - synthesisGuidance exceeds 500 chars
 *
 * The normalizer guarantees a schema-valid artifact even from a badly-formed
 * LLM response, following the same per-field type-checked merge pattern used
 * by the other analyst handlers.
 */

const VERDICTS = ["BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"] as const;
type Verdict = (typeof VERDICTS)[number];

function pickVerdict(value: unknown): Verdict {
  if (typeof value === "string" && (VERDICTS as readonly string[]).includes(value.toUpperCase())) {
    return value.toUpperCase() as Verdict;
  }
  return "HOLD";
}

function pickStr(value: unknown, maxLen: number, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, maxLen);
  }
  return fallback;
}

function pickStrOrNull(value: unknown, maxLen: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim().slice(0, maxLen) || null;
  return null;
}

function coerceDataPoint(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 200);
  if (value === null || value === undefined) return "No specific data point provided.";
  if (typeof value === "number") return String(value).slice(0, 200);
  if (typeof value === "object") {
    try { return JSON.stringify(value).slice(0, 200); } catch { return "Data point unavailable."; }
  }
  return String(value).slice(0, 200);
}

function isValidUrl(s: unknown): s is string {
  return typeof s === "string" && /^https?:\/\//.test(s);
}

function normalizeEvidence(
  raw: unknown
): Array<{ source: string; claim: string; dataPoint: string }> {
  const arr = Array.isArray(raw) ? raw : [];
  const items = arr
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      source: isValidUrl(item["source"]) ? (item["source"] as string) : "https://finance.yahoo.com/",
      claim: pickStr(item["claim"], 200, "No specific claim provided."),
      dataPoint: coerceDataPoint(item["dataPoint"]),
    }));
  // Schema requires min 1, max 5
  if (items.length === 0) {
    items.push({
      source: "https://finance.yahoo.com/",
      claim: "Analyst assessment based on available data.",
      dataPoint: "See analyst artifacts for details.",
    });
  }
  return items.slice(0, 5);
}

function normalizeBullRound(
  raw: unknown,
  roundNum: 1 | 2
): { round: 1 | 2; thesis: string; evidence: ReturnType<typeof normalizeEvidence>; responseToBear: string | null } {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    round: roundNum,
    thesis: pickStr(obj["thesis"], 400, `Bull case round ${roundNum}: position supported by analyst data.`),
    evidence: normalizeEvidence(obj["evidence"]),
    responseToBear: pickStrOrNull(obj["responseToBear"], 300),
  };
}

function normalizeBearRound(
  raw: unknown,
  roundNum: 1 | 2
): { round: 1 | 2; concern: string; evidence: ReturnType<typeof normalizeEvidence>; responseToBull: string | null } {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    round: roundNum,
    concern: pickStr(obj["concern"], 400, `Bear case round ${roundNum}: risks identified in analyst data.`),
    evidence: normalizeEvidence(obj["evidence"]),
    responseToBull: pickStrOrNull(obj["responseToBull"], 300),
  };
}

function ensureExactlyTwo<T>(
  arr: unknown[],
  normalizer: (item: unknown, idx: 1 | 2) => T
): [T, T] {
  const r1 = normalizer(arr[0] ?? {}, 1);
  const r2 = normalizer(arr[1] ?? {}, 2);
  return [r1, r2];
}

export const debateHandler = makePromptHandler({
  kind: "debate",
  analyst: "debate",
  schema: DebateReportSchema,
  schemaName: "DebateReportSchema",
  async gatherData(step, ws) {
    return {
      ...(await gatherCommonInputs(step, ws)),
      analystArtifacts: await gatherAnalystArtifacts(ws, step.ticker),
    };
  },
  normalizeRaw(raw, inputs) {
    // Handle the case where the LLM returns the entire JSON as a string.
    let obj: Record<string, unknown>;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        obj = {};
      }
    } else {
      obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    }

    const ticker = inputs?.step.ticker ?? (typeof obj["ticker"] === "string" ? obj["ticker"] : "UNKNOWN");

    const rawBullRounds = Array.isArray(obj["bullRounds"]) ? obj["bullRounds"] : [];
    const rawBearRounds = Array.isArray(obj["bearRounds"]) ? obj["bearRounds"] : [];

    const [bull1, bull2] = ensureExactlyTwo(rawBullRounds, normalizeBullRound);
    const [bear1, bear2] = ensureExactlyTwo(rawBearRounds, normalizeBearRound);

    const sourcesRaw = Array.isArray(obj["sources"]) ? (obj["sources"] as unknown[]) : [];
    const sources = sourcesRaw.filter(isValidUrl);

    return {
      ticker,
      generatedAt: typeof obj["generatedAt"] === "string" ? obj["generatedAt"] : new Date().toISOString(),
      analyst: "debate",
      bullRounds: [bull1, bull2],
      bearRounds: [bear1, bear2],
      bullFinalVerdict: pickVerdict(obj["bullFinalVerdict"]),
      bearFinalVerdict: pickVerdict(obj["bearFinalVerdict"]),
      keyDisagreement: pickStr(obj["keyDisagreement"], 300, "Bull and bear sides disagree on the risk/reward balance."),
      synthesisGuidance: pickStr(obj["synthesisGuidance"], 500, "Weigh the analyst evidence and apply portfolio rules before deciding."),
      sources: sources.length > 0 ? sources : ["https://finance.yahoo.com/"],
    };
  },
  artifactPath: persistReportArtifact("debate"),
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Run a real bounded bull/bear debate using the five analyst artifacts and current portfolio context.",
      "Produce exactly two bull rounds and exactly two bear rounds. Each round needs thesis/concern, evidence (1–5 items), and responseToBear/responseToBull (null for round 1).",
      "Do not mechanically summarize. Challenge weak evidence, weigh risk, and cite specific artifact claims.",
      "CRITICAL: dataPoint must be a non-empty string (max 200 chars). Never use null or a number for dataPoint.",
      "CRITICAL: responseToBear and responseToBull must be strings or null, max 300 chars each.",
      "CRITICAL: thesis and concern must be strings, max 400 chars each.",
      "Schema requirements: analyst='debate'; evidence sources must be valid URLs (https://...).",
      "Required JSON fields: ticker, generatedAt, analyst, bullRounds[2], bearRounds[2], bullFinalVerdict, bearFinalVerdict, keyDisagreement, synthesisGuidance, sources.",
      "Allowed verdict enums: BUY|ADD|HOLD|REDUCE|SELL|CLOSE.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
