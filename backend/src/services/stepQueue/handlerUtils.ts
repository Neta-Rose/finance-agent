import { promises as fs } from "fs";
import type { z } from "zod";
import type { UserWorkspace } from "../../middleware/userIsolation.js";
import { PortfolioFileSchema } from "../../schemas/portfolio.js";
import type { Exchange } from "../../types/index.js";
import { getPrice, getPriceHistory, getUsdIlsRate } from "../priceService.js";
import { oneShotJsonCompletion } from "../llm/oneshotCall.js";
import { eventStore } from "../eventStore.js";
import { atomicWriteJson } from "./artifactIO.js";
import type { BuiltPrompt, StepHandler, StepInputs, ValidationResult } from "./handlers.js";
import type { ClaimedStepWorkItem, ModelTier, StepKind } from "./types.js";

export async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

export async function readTextIfExists(filePath: string, maxChars = 4000): Promise<string | null> {
  try {
    return (await fs.readFile(filePath, "utf-8")).slice(0, maxChars);
  } catch {
    return null;
  }
}

export async function getPortfolioPosition(ws: UserWorkspace, ticker: string): Promise<{
  ticker: string;
  exchange: Exchange;
  shares: number;
  unitAvgBuyPrice: number;
  unitCurrency: string;
  account: string;
} | null> {
  const raw = await fs.readFile(ws.portfolioFile, "utf-8");
  const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));
  for (const [account, positions] of Object.entries(portfolio.accounts)) {
    const position = positions.find((item) => item.ticker === ticker);
    if (position) return { ...position, account };
  }
  return null;
}

export async function gatherCommonInputs(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<Record<string, unknown>> {
  const position = await getPortfolioPosition(ws, step.ticker);
  const usdIlsRate = await getUsdIlsRate();
  const price = position ? await getPrice(step.ticker, position.exchange, usdIlsRate) : null;
  return {
    ticker: step.ticker,
    position,
    price,
    usdIlsRate,
    currentStrategy: await readJsonIfExists(ws.strategyFile(step.ticker)),
    userProfile: await readTextIfExists(ws.userMdFile),
  };
}

export async function gatherAnalystArtifacts(ws: UserWorkspace, ticker: string): Promise<Record<string, unknown>> {
  const names = ["fundamentals", "technical", "sentiment", "macro", "risk"];
  const entries = await Promise.all(
    names.map(async (name) => [name, await readJsonIfExists(ws.reportFile(ticker, name))] as const)
  );
  return Object.fromEntries(entries);
}

export async function gatherTechnicalData(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<Record<string, unknown>> {
  const common = await gatherCommonInputs(step, ws);
  const history = await getPriceHistory(step.ticker, "3M");
  return { ...common, history: history.slice(-90) };
}

export function schemaInstruction(schemaName: string): string {
  return `Return exactly one JSON object matching ${schemaName}. No markdown, no prose, no code, no tool calls.`;
}

export function validateWithSchema<T>(schema: z.ZodType<T>, raw: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, artifact: parsed.data } : { ok: false, error: parsed.error };
}

export function persistReportArtifact<T>(analyst: string) {
  return async (artifact: T, ws: UserWorkspace, step: ClaimedStepWorkItem): Promise<string> => {
    const filePath = ws.reportFile(step.ticker, analyst);
    await atomicWriteJson(filePath, artifact);
    return filePath;
  };
}

export async function callStepLlm(
  step: ClaimedStepWorkItem,
  prompt: BuiltPrompt,
  model: { tier: ModelTier; primary: string; fallback: string | null },
  analyst: string
): Promise<unknown> {
  const startedAt = Date.now();
  try {
    const result = await oneShotJsonCompletion(prompt, model);
    await eventStore.logRequest({
      userId: step.userId,
      purpose: "step_queue",
      ticker: step.ticker,
      jobId: step.jobId,
      stepId: step.id,
      sourceClass: "backend_job",
      analyst,
      model: result.model,
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut,
      costUsd: result.usage.costUsd,
      latencyMs: Date.now() - startedAt,
      status: "success",
      errorMessage: null,
      attributionSource: "step_queue",
      rejectionReason: null,
      timestamp: new Date().toISOString(),
    });
    return result.json;
  } catch (error) {
    await eventStore.logRequest({
      userId: step.userId,
      purpose: "step_queue",
      ticker: step.ticker,
      jobId: step.jobId,
      stepId: step.id,
      sourceClass: "backend_job",
      analyst,
      model: model.primary,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      status: error instanceof Error && error.name === "AbortError" ? "timeout" : "error",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      attributionSource: "step_queue",
      rejectionReason: null,
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}

export function makePromptHandler<T>(config: {
  kind: StepKind;
  analyst: string;
  schema: z.ZodType<T>;
  schemaName: string;
  gatherData: (step: ClaimedStepWorkItem, ws: UserWorkspace) => Promise<Record<string, unknown>>;
  artifactPath: (artifact: T, ws: UserWorkspace, step: ClaimedStepWorkItem) => Promise<string>;
  buildUserPrompt: (inputs: StepInputs) => string;
}): StepHandler<T> {
  return {
    kind: config.kind,
    async gatherInputs(step, ws) {
      return {
        step,
        workspace: ws,
        gatheredAt: new Date().toISOString(),
        data: await config.gatherData(step, ws),
      };
    },
    buildPrompt(inputs, _tier) {
      return {
        system: [
          `You are Clawd's ${config.analyst} step for portfolio user ${inputs.step.userId}.`,
          schemaInstruction(config.schemaName),
          "Use only the provided data. If a field is unknown, use null or an explicit unknown enum value allowed by the schema.",
        ].join("\n"),
        user: config.buildUserPrompt(inputs),
        schema: config.schema,
      };
    },
    call(prompt, model, step) {
      if (!step) throw new Error(`Step context is required for ${config.kind}`);
      return callStepLlm(step, prompt, model, config.analyst);
    },
    validate(raw) {
      return validateWithSchema(config.schema, raw);
    },
    persistArtifact: config.artifactPath,
  };
}
