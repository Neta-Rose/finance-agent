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
}

export interface ModelTierAssignment {
  tier: ModelTier;
  stepKind: StepKind;
  model: string;
  fallback: string | null;
}

const DEFAULT_ASSIGNMENTS: Record<ModelTier, Record<StepKind, string>> = {
  free: {
    "analyst.fundamentals": "google/gemma-3-27b-it:free",
    "analyst.technical": "google/gemma-3-27b-it:free",
    "analyst.sentiment": "google/gemma-3-27b-it:free",
    "analyst.macro": "google/gemma-3-27b-it:free",
    "analyst.risk": "google/gemma-3-27b-it:free",
    debate: "meta-llama/llama-3.3-70b-instruct:free",
    synthesis: "meta-llama/llama-3.3-70b-instruct:free",
  },
  cheap: {
    "analyst.fundamentals": "deepseek/deepseek-v3.2",
    "analyst.technical": "deepseek/deepseek-v3.2",
    "analyst.sentiment": "google/gemini-2.5-flash",
    "analyst.macro": "deepseek/deepseek-v3.2",
    "analyst.risk": "deepseek/deepseek-v3.2",
    debate: "google/gemini-2.5-flash",
    synthesis: "google/gemini-2.5-flash",
  },
  balanced: {
    "analyst.fundamentals": "google/gemini-2.5-flash",
    "analyst.technical": "google/gemini-2.5-flash",
    "analyst.sentiment": "google/gemini-2.5-flash",
    "analyst.macro": "google/gemini-2.5-flash",
    "analyst.risk": "google/gemini-2.5-flash",
    debate: "claude-sonnet-4-6",
    synthesis: "claude-sonnet-4-6",
  },
  expensive: {
    "analyst.fundamentals": "claude-sonnet-4-6",
    "analyst.technical": "claude-sonnet-4-6",
    "analyst.sentiment": "claude-sonnet-4-6",
    "analyst.macro": "claude-sonnet-4-6",
    "analyst.risk": "claude-sonnet-4-6",
    debate: "claude-opus-4-7",
    synthesis: "claude-opus-4-7",
  },
};

function isModelTier(value: unknown): value is ModelTier {
  return typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value);
}

export async function readUserModelTier(userId: string): Promise<ModelTier> {
  try {
    const raw = await fs.readFile(path.join(USERS_DIR, userId, "profile.json"), "utf-8");
    const parsed = JSON.parse(raw) as { modelTier?: unknown };
    return isModelTier(parsed.modelTier) ? parsed.modelTier : DEFAULT_MODEL_TIER;
  } catch {
    return DEFAULT_MODEL_TIER;
  }
}

export function namespaceModelForUser(userId: string, model: string): string {
  const normalized = model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model;
  return normalized.startsWith(`clawd-${userId}/`) ? normalized : normalized;
}

export function resolveAssignedModel(
  userId: string,
  assignment: ModelTierAssignment
): ResolvedModel {
  return {
    tier: assignment.tier,
    primary: namespaceModelForUser(userId, assignment.model),
    fallback: assignment.fallback ? namespaceModelForUser(userId, assignment.fallback) : null,
  };
}

export async function resolveStepModel(ds: DataSource, userId: string, stepKind: StepKind, tier: ModelTier): Promise<ResolvedModel> {
  const rows = await ds.query(
    `SELECT tier, step_kind, model, fallback
       FROM model_tier_assignments
      WHERE tier = $1
        AND step_kind = $2
      LIMIT 1`,
    [tier, stepKind]
  ) as Array<{ model: string; fallback: string | null }>;
  const row = rows[0];
  return resolveAssignedModel(userId, {
    tier,
    stepKind,
    model: row?.model ?? DEFAULT_ASSIGNMENTS[tier][stepKind],
    fallback: row?.fallback ?? null,
  });
}
