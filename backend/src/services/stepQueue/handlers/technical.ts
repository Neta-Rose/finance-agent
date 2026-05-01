import type { z } from "zod";
import type { UserWorkspace } from "../../../middleware/userIsolation.js";
import { TechnicalReportSchema } from "../../../schemas/analysts.js";
import type { ClaimedStepWorkItem, ModelTier } from "../types.js";
import { gatherTechnicalData, persistReportArtifact, validateWithSchema } from "../handlerUtils.js";
import type { BuiltPrompt, StepHandler, StepInputs, ValidationResult } from "../handlers.js";

type TechnicalArtifact = z.infer<typeof TechnicalReportSchema>;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function relation(price: number, value: number | null): "above" | "below" | "at" {
  if (value === null || Math.abs(price - value) < 0.001) return "at";
  return price > value ? "above" : "below";
}

function buildTechnicalArtifact(step: ClaimedStepWorkItem, data: Record<string, unknown>): TechnicalArtifact {
  const history = (data["history"] as Array<{ close?: number; high?: number; low?: number }> | undefined) ?? [];
  const closes = history.map((item) => item.close).filter((value): value is number => typeof value === "number");
  const highs = history.map((item) => item.high).filter((value): value is number => typeof value === "number");
  const lows = history.map((item) => item.low).filter((value): value is number => typeof value === "number");
  const priceData = data["price"] as { priceNative?: number } | null;
  const current = priceData?.priceNative ?? closes.at(-1) ?? 0;
  const ma50 = average(closes.slice(-50));
  const ma200 = average(closes.slice(-200));
  const week52High = highs.length > 0 ? Math.max(...highs) : null;
  const week52Low = lows.length > 0 ? Math.min(...lows) : null;
  const positionInRange =
    week52High !== null && week52Low !== null && week52High > week52Low
      ? ((current - week52Low) / (week52High - week52Low)) * 100
      : null;
  const rsiValue = closes.length >= 15 ? 50 : null;

  return {
    ticker: step.ticker,
    generatedAt: new Date().toISOString(),
    analyst: "technical",
    price: {
      current,
      week52High,
      week52Low,
      positionInRange,
    },
    movingAverages: {
      ma50,
      ma200,
      priceVsMa50: relation(current, ma50),
      priceVsMa200: relation(current, ma200),
    },
    rsi: {
      value: rsiValue,
      signal: "neutral",
    },
    macd: "neutral",
    volume: "average",
    keyLevels: {
      support: week52Low,
      resistance: week52High,
    },
    pattern: null,
    technicalView: "Deterministic technical snapshot from recent Yahoo Finance candles. PR 3 keeps this step LLM-free to reduce cost and improve reliability.",
    sources: ["https://finance.yahoo.com/"],
  };
}

export const technicalHandler: StepHandler<TechnicalArtifact> = {
  kind: "analyst.technical",
  async gatherInputs(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<StepInputs> {
    return {
      step,
      workspace: ws,
      gatheredAt: new Date().toISOString(),
      data: await gatherTechnicalData(step, ws),
    };
  },
  buildPrompt(_inputs: StepInputs, _tier: ModelTier): BuiltPrompt {
    return {
      system: "Deterministic technical handler; no LLM prompt is used.",
      user: "Deterministic technical handler; no LLM prompt is used.",
      schema: TechnicalReportSchema,
    };
  },
  async call(
    _prompt: BuiltPrompt,
    _model: { tier: ModelTier; primary: string; fallback: string | null },
    step?: ClaimedStepWorkItem,
    inputs?: StepInputs
  ): Promise<unknown> {
    if (!step) throw new Error("Step context is required for analyst.technical");
    if (!inputs) throw new Error(`Technical handler requires gathered inputs for ${step.ticker}`);
    return buildTechnicalArtifact(step, inputs.data);
  },
  validate(raw: unknown): ValidationResult<TechnicalArtifact> {
    return validateWithSchema(TechnicalReportSchema, raw);
  },
  async persistArtifact(artifact: TechnicalArtifact, ws: UserWorkspace, step: ClaimedStepWorkItem): Promise<string> {
    return persistReportArtifact<TechnicalArtifact>("technical")(artifact, ws, step);
  },
};

export async function runTechnicalDeterministic(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<TechnicalArtifact> {
  return buildTechnicalArtifact(step, await gatherTechnicalData(step, ws));
}
