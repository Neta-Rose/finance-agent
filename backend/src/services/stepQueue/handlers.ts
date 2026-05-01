import type { z, ZodError, ZodTypeAny } from "zod";
import type { UserWorkspace } from "../../middleware/userIsolation.js";
import type { ClaimedStepWorkItem, ModelTier, StepKind } from "./types.js";
import { debateHandler } from "./handlers/debate.js";
import { fundamentalsHandler } from "./handlers/fundamentals.js";
import { macroHandler } from "./handlers/macro.js";
import { riskHandler } from "./handlers/risk.js";
import { sentimentHandler } from "./handlers/sentiment.js";
import { synthesisHandler } from "./handlers/synthesis.js";
import { technicalHandler } from "./handlers/technical.js";

export interface StepInputs {
  step: ClaimedStepWorkItem;
  workspace: UserWorkspace;
  gatheredAt: string;
  data: Record<string, unknown>;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  schema: ZodTypeAny;
}

export type ValidationResult<T> =
  | { ok: true; artifact: T }
  | { ok: false; error: ZodError };

export interface StepHandler<TArtifact = unknown> {
  kind: StepKind;
  gatherInputs(step: ClaimedStepWorkItem, ws: UserWorkspace): Promise<StepInputs>;
  buildPrompt(inputs: StepInputs, tier: ModelTier): BuiltPrompt;
  call(
    prompt: BuiltPrompt,
    model: { tier: ModelTier; primary: string; fallback: string | null },
    step?: ClaimedStepWorkItem,
    inputs?: StepInputs
  ): Promise<unknown>;
  validate(raw: unknown, schema: z.ZodType<TArtifact>): ValidationResult<TArtifact>;
  persistArtifact(artifact: TArtifact, ws: UserWorkspace, step: ClaimedStepWorkItem): Promise<string>;
}

const handlers = new Map<StepKind, StepHandler>([
  [fundamentalsHandler.kind, fundamentalsHandler],
  [technicalHandler.kind, technicalHandler],
  [sentimentHandler.kind, sentimentHandler],
  [macroHandler.kind, macroHandler],
  [riskHandler.kind, riskHandler],
  [debateHandler.kind, debateHandler],
  [synthesisHandler.kind, synthesisHandler],
]);

export function handlerFor(kind: StepKind): StepHandler {
  const handler = handlers.get(kind);
  if (!handler) {
    throw new Error(`No step handler registered for ${kind}`);
  }
  return handler;
}

export function registeredStepKinds(): StepKind[] {
  return Array.from(handlers.keys());
}
