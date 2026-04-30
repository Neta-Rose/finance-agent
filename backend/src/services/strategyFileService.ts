import { promises as fs } from "fs";
import { StrategySchema, type Strategy, type StrategyMetadata } from "../schemas/index.js";

export interface StrategyFileLoadOptions {
  repair?: boolean;
  tickerHint?: string;
}

export interface StrategyFileLoadResult {
  valid: boolean;
  strategy?: Strategy;
  errors?: string[];
  repaired: boolean;
  repairNotes: string[];
  filePath: string;
  validatedAt: string;
}

type JsonRecord = Record<string, unknown>;

const VERDICTS = new Set<Strategy["verdict"]>(["BUY", "ADD", "HOLD", "REDUCE", "SELL", "CLOSE"]);
const CONFIDENCE = new Set<Strategy["confidence"]>(["high", "medium", "low"]);
const TIMEFRAME_ALIASES = new Map<string, Strategy["timeframe"]>([
  ["week", "week"],
  ["weeks", "week"],
  ["month", "months"],
  ["months", "months"],
  ["year", "years"],
  ["years", "years"],
  ["longterm", "long_term"],
  ["long_term", "long_term"],
  ["long-term", "long_term"],
  ["long term", "long_term"],
  ["undefined", "undefined"],
  ["unknown", "undefined"],
  ["unspecified", "undefined"],
]);
const METADATA_SOURCE_ALIASES = new Map<string, StrategyMetadata["source"]>([
  ["bootstrap", "bootstrap"],
  ["bootstrap_analysis", "bootstrap"],
  ["bootstrap_report", "bootstrap"],
  ["initial_analysis", "bootstrap"],
  ["initial_bootstrap", "bootstrap"],
  ["full_report", "full_report"],
  ["full_report_analysis", "full_report"],
  ["deep_dive", "deep_dive"],
  ["deep_dive_analysis", "deep_dive"],
  ["new_ideas", "new_ideas"],
  ["new_ideas_analysis", "new_ideas"],
  ["manual_exploration", "manual_exploration"],
  ["manual", "manual_exploration"],
  ["exploration", "manual_exploration"],
  ["migration", "migration"],
]);
const METADATA_STATUS_ALIASES = new Map<string, StrategyMetadata["status"]>([
  ["provisional", "provisional"],
  ["draft", "provisional"],
  ["pending", "provisional"],
  ["validated", "validated"],
  ["valid", "validated"],
  ["complete", "validated"],
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableDateString(value: unknown): string | null {
  const text = asTrimmedString(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeTicker(value: unknown, tickerHint?: string): string | null {
  const source = asTrimmedString(value) ?? asTrimmedString(tickerHint);
  if (!source) return null;
  const normalized = source.toUpperCase();
  return /^[A-Z0-9.]{1,12}$/.test(normalized) ? normalized : null;
}

function normalizeVerdict(value: unknown): Strategy["verdict"] {
  const normalized = asTrimmedString(value)?.toUpperCase();
  return normalized && VERDICTS.has(normalized as Strategy["verdict"])
    ? (normalized as Strategy["verdict"])
    : "HOLD";
}

function normalizeConfidence(value: unknown): Strategy["confidence"] {
  const normalized = asTrimmedString(value)?.toLowerCase();
  return normalized && CONFIDENCE.has(normalized as Strategy["confidence"])
    ? (normalized as Strategy["confidence"])
    : "low";
}

function normalizeTimeframe(value: unknown): Strategy["timeframe"] {
  const normalized = asTrimmedString(value)?.toLowerCase();
  if (!normalized) return "undefined";
  return TIMEFRAME_ALIASES.get(normalized) ?? "undefined";
}

function normalizeStringList(
  value: unknown,
  maxItems: number,
  maxLength: number,
  repairNotes: string[],
  label: string
): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n|;/).map((item) => item.trim()).filter(Boolean)
      : [];
  const items = source
    .map((item) => asTrimmedString(item))
    .filter((item): item is string => item !== null)
    .map((item) => item.length > maxLength ? item.slice(0, maxLength) : item);
  const deduped = Array.from(new Set(items));
  if (deduped.length > maxItems) {
    repairNotes.push(`${label} truncated to ${maxItems} item(s)`);
  }
  return deduped.slice(0, maxItems);
}

function inferMetadataSource(
  rawMetadata: JsonRecord | null,
  record: JsonRecord
): StrategyMetadata["source"] {
  const rawSource = asTrimmedString(rawMetadata?.["source"])?.toLowerCase();
  if (rawSource && METADATA_SOURCE_ALIASES.has(rawSource)) {
    return METADATA_SOURCE_ALIASES.get(rawSource)!;
  }
  const trigger = asTrimmedString(record["deepDiveTriggeredBy"])?.toLowerCase();
  if (trigger === "manual_exploration" || trigger === "manual") {
    return "manual_exploration";
  }
  if (trigger === "new_ideas") {
    return "new_ideas";
  }
  if (toNullableDateString(record["lastDeepDiveAt"])) {
    return "deep_dive";
  }
  return "bootstrap";
}

function inferMetadataStatus(rawMetadata: JsonRecord | null): StrategyMetadata["status"] {
  const rawStatus = asTrimmedString(rawMetadata?.["status"])?.toLowerCase();
  if (rawStatus && METADATA_STATUS_ALIASES.has(rawStatus)) {
    return METADATA_STATUS_ALIASES.get(rawStatus)!;
  }
  return "provisional";
}

function normalizeCatalysts(value: unknown, repairNotes: string[]): Strategy["catalysts"] {
  if (!Array.isArray(value)) return [];

  const normalized = value.flatMap((item): Strategy["catalysts"] => {
    const stringItem = asTrimmedString(item);
    if (stringItem) {
      repairNotes.push("Converted string catalyst into structured catalyst object");
      return [{
        description: stringItem.slice(0, 300),
        expiresAt: null,
        triggered: false,
      }];
    }

    if (!isRecord(item)) return [];

    const description = asTrimmedString(item["description"])
      ?? asTrimmedString(item["headline"])
      ?? asTrimmedString(item["title"])
      ?? asTrimmedString(item["name"]);
    if (!description) return [];

    return [{
      description: description.slice(0, 300),
      expiresAt: toNullableDateString(item["expiresAt"] ?? item["date"] ?? item["deadline"]),
      triggered: Boolean(item["triggered"]),
    }];
  });

  const deduped = Array.from(
    new Map(
      normalized.map((item) => [`${item.description}::${item.expiresAt ?? "none"}`, item] as const)
    ).values()
  );

  if (deduped.length > 10) {
    repairNotes.push("Truncated catalysts to 10 item(s)");
  }
  return deduped.slice(0, 10);
}

function buildCanonicalStrategy(record: JsonRecord, tickerHint: string | undefined): {
  strategy: Strategy;
  repairNotes: string[];
} {
  const repairNotes: string[] = [];
  const ticker = normalizeTicker(record["ticker"], tickerHint);
  const updatedAt = toNullableDateString(record["updatedAt"]) ?? new Date().toISOString();
  const rawMetadata = isRecord(record["metadata"]) ? record["metadata"] : null;
  const metadataSource = inferMetadataSource(rawMetadata, record);
  const metadataStatus = inferMetadataStatus(rawMetadata);

  if (asTrimmedString(rawMetadata?.["source"])?.toLowerCase() !== metadataSource) {
    repairNotes.push(`Normalized metadata.source to ${metadataSource}`);
  }
  if (asTrimmedString(rawMetadata?.["status"])?.toLowerCase() !== metadataStatus) {
    repairNotes.push(`Normalized metadata.status to ${metadataStatus}`);
  }

  const strategy: Strategy = {
    ticker: ticker ?? "",
    updatedAt,
    version: Math.max(1, Math.trunc(toFiniteNumber(record["version"], 1))),
    verdict: normalizeVerdict(record["verdict"]),
    confidence: normalizeConfidence(record["confidence"]),
    reasoning: (asTrimmedString(record["reasoning"]) ?? "Pending initial analysis").slice(0, 800),
    timeframe: normalizeTimeframe(record["timeframe"]),
    positionSizeILS: toFiniteNumber(record["positionSizeILS"], 0),
    positionWeightPct: toFiniteNumber(record["positionWeightPct"], 0),
    entryConditions: normalizeStringList(record["entryConditions"], 5, 200, repairNotes, "entryConditions"),
    exitConditions: normalizeStringList(record["exitConditions"], 5, 200, repairNotes, "exitConditions"),
    catalysts: normalizeCatalysts(record["catalysts"], repairNotes),
    bullCase: (asTrimmedString(record["bullCase"] ?? record["bull_case"]) ?? null)?.slice(0, 600) ?? null,
    bearCase: (asTrimmedString(record["bearCase"] ?? record["bear_case"]) ?? null)?.slice(0, 600) ?? null,
    lastDeepDiveAt: toNullableDateString(record["lastDeepDiveAt"]),
    deepDiveTriggeredBy: asTrimmedString(record["deepDiveTriggeredBy"]) ?? null,
    metadata: {
      source: metadataSource,
      status: metadataStatus,
      generatedAt: toNullableDateString(rawMetadata?.["generatedAt"]) ?? updatedAt,
      userGuidanceApplied: Boolean(rawMetadata?.["userGuidanceApplied"]),
    },
  };

  if (!ticker) {
    repairNotes.push("Ticker could not be normalized");
  }
  return { strategy, repairNotes };
}

function validationErrors(result: ReturnType<typeof StrategySchema.safeParse>): string[] {
  if (result.success) return [];
  return result.error.errors.map((error) => `${error.path.join(".")}: ${error.message}`);
}

export async function loadStrategyFile(
  filePath: string,
  options?: StrategyFileLoadOptions
): Promise<StrategyFileLoadResult> {
  const validatedAt = new Date().toISOString();
  let parsed: unknown;

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        errors: [`Invalid JSON: ${message}`],
        repaired: false,
        repairNotes: [],
        filePath,
        validatedAt,
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        valid: false,
        errors: [`File not found: ${filePath}`],
        repaired: false,
        repairNotes: [],
        filePath,
        validatedAt,
      };
    }
    throw error;
  }

  const direct = StrategySchema.safeParse(parsed);
  if (direct.success) {
    return {
      valid: true,
      strategy: direct.data,
      repaired: false,
      repairNotes: [],
      filePath,
      validatedAt,
    };
  }

  if (!isRecord(parsed)) {
    return {
      valid: false,
      errors: validationErrors(direct),
      repaired: false,
      repairNotes: [],
      filePath,
      validatedAt,
    };
  }

  const { strategy, repairNotes } = buildCanonicalStrategy(parsed, options?.tickerHint);
  const repairedParse = StrategySchema.safeParse(strategy);
  if (!repairedParse.success) {
    return {
      valid: false,
      errors: validationErrors(repairedParse),
      repaired: false,
      repairNotes,
      filePath,
      validatedAt,
    };
  }

  const repaired = JSON.stringify(repairedParse.data) !== JSON.stringify(parsed);
  if (repaired && options?.repair !== false) {
    await fs.writeFile(filePath, JSON.stringify(repairedParse.data, null, 2), "utf-8");
  }

  return {
    valid: true,
    strategy: repairedParse.data,
    repaired,
    repairNotes,
    filePath,
    validatedAt,
  };
}
