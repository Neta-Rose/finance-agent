import { promises as fs } from "fs";
import path from "path";
import type { DataSource } from "typeorm";
import { resolveConfiguredPath } from "../paths.js";
import { MODEL_TIERS, type ModelTier, type StepKind } from "./types.js";

const USERS_DIR = resolveConfiguredPath(process.env["USERS_DIR"], "../users");
const DEFAULT_MODEL_TIER: ModelTier = "balanced";

export interface ResolvedModel {
  tier: ModelTier;
  primary: string;
  fallback: string | null;
  provider: string;
}

export interface ModelTierAssignment {
  tier: ModelTier;
  stepKind: StepKind;
  model: string;
  fallback: string | null;
}

export const DEFAULT_MODEL_TIER_ASSIGNMENTS: Record<ModelTier, Record<StepKind, string>> = {
  free: {
    "analyst.fundamentals": "google/gemma-3-27b-it:free",
    "analyst.technical": "google/gemma-3-27b-it:free",
    "analyst.sentiment": "google/gemma-3-27b-it:free",
    "analyst.macro": "google/gemma-3-27b-it:free",
    "analyst.risk": "google/gemma-3-27b-it:free",
    debate: "meta-llama/llama-3.3-70b-instruct:free",
    synthesis: "meta-llama/llama-3.3-70b-instruct:free",
    // Deterministic step kinds — no LLM; model string is a placeholder only.
    "quick_check.evaluate": "none",
    "tracking.evaluate": "none",
    // Chat agent (Phase 5)
    "chat_agent": "google/gemini-2.5-flash",
  },
  cheap: {
    "analyst.fundamentals": "deepseek/deepseek-v3.2",
    "analyst.technical": "deepseek/deepseek-v3.2",
    "analyst.sentiment": "google/gemini-2.5-flash",
    "analyst.macro": "deepseek/deepseek-v3.2",
    "analyst.risk": "deepseek/deepseek-v3.2",
    debate: "google/gemini-2.5-flash",
    synthesis: "google/gemini-2.5-flash",
    "quick_check.evaluate": "none",
    "tracking.evaluate": "none",
    "chat_agent": "google/gemini-2.5-flash",
  },
  balanced: {
    "analyst.fundamentals": "google/gemini-2.5-flash",
    "analyst.technical": "google/gemini-2.5-flash",
    "analyst.sentiment": "google/gemini-2.5-flash",
    "analyst.macro": "google/gemini-2.5-flash",
    "analyst.risk": "google/gemini-2.5-flash",
    debate: "anthropic/claude-sonnet-4-5",
    synthesis: "anthropic/claude-sonnet-4-5",
    "quick_check.evaluate": "none",
    "tracking.evaluate": "none",
    "chat_agent": "google/gemini-2.5-flash",
  },
  expensive: {
    "analyst.fundamentals": "anthropic/claude-sonnet-4-5",
    "analyst.technical": "anthropic/claude-sonnet-4-5",
    "analyst.sentiment": "anthropic/claude-sonnet-4-5",
    "analyst.macro": "anthropic/claude-sonnet-4-5",
    "analyst.risk": "anthropic/claude-sonnet-4-5",
    debate: "anthropic/claude-opus-4-5",
    synthesis: "anthropic/claude-opus-4-5",
    "quick_check.evaluate": "none",
    "tracking.evaluate": "none",
    "chat_agent": "anthropic/claude-sonnet-4-5",
  },
};

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value);
}
  try {
    const raw = await fs.readFile(path.join(USERS_DIR, userId, "profile.json"), "utf-8");
    const parsed = JSON.parse(raw) as { modelTier?: unknown };
    return isModelTier(parsed.modelTier) ? parsed.modelTier : DEFAULT_MODEL_TIER;
  } catch {
    return DEFAULT_MODEL_TIER;
  }
}

export async function writeUserModelTier(userId: string, modelTier: ModelTier): Promise<ModelTier> {
  const profilePath = path.join(USERS_DIR, userId, "profile.json");
  const raw = await fs.readFile(profilePath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  await fs.writeFile(
    profilePath,
    JSON.stringify({ ...parsed, modelTier }, null, 2),
    "utf-8"
  );
  return modelTier;
}

export function resolveAssignedModel(
  _userId: string,
  assignment: ModelTierAssignment
): ResolvedModel {
  return {
    tier: assignment.tier,
    primary: assignment.model,
    fallback: assignment.fallback ?? null,
    provider: "openrouter", // default; overridden by resolveStepModel when DB row has provider column
  };
}

export async function resolveStepModel(ds: DataSource, userId: string, stepKind: StepKind, tier: ModelTier): Promise<ResolvedModel> {
  const rows = await ds.query(
    `SELECT tier, step_kind, model, fallback, provider
       FROM model_tier_assignments
      WHERE tier = $1
        AND step_kind = $2
      LIMIT 1`,
    [tier, stepKind]
  ) as Array<{ model: string; fallback: string | null; provider?: string }>;
  const row = rows[0];
  const base = resolveAssignedModel(userId, {
    tier,
    stepKind,
    model: row?.model ?? DEFAULT_MODEL_TIER_ASSIGNMENTS[tier][stepKind],
    fallback: row?.fallback ?? null,
  });
  return { ...base, provider: row?.provider ?? "openrouter" };
}

export async function ensureDefaultModelTierAssignments(ds: DataSource): Promise<void> {
  for (const tier of MODEL_TIERS) {
    for (const [stepKind, model] of Object.entries(DEFAULT_MODEL_TIER_ASSIGNMENTS[tier]) as Array<[StepKind, string]>) {
      await ds.query(
        `INSERT INTO model_tier_assignments (tier, step_kind, model, fallback, updated_at, updated_by)
         VALUES ($1, $2, $3, NULL, NOW(), 'system_default')
         ON CONFLICT (tier, step_kind) DO NOTHING`,
        [tier, stepKind, model]
      );
    }
  }
}
