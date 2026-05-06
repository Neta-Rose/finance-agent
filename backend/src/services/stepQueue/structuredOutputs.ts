import type { z, ZodTypeAny } from "zod";
import type { ProviderMessage, SchemaMode } from "../chat/llmProviders/index.js";
import { getLlmProvider, type ProviderName } from "../chat/llmProviders/index.js";

/**
 * Structured-output call helper — Phase 4, task 4.3.
 *
 * Spec: design.md §10.2; H1.1, H1.2, H1.3.
 *
 * Wraps the LlmProvider with Zod validation. On success, records the
 * `schemaMode` that produced the artifact. On Zod failure, falls through to
 * `normalizeRaw` (defense-in-depth per H1.3) — the self-correcting retry
 * wrapper in `selfCorrectingRetry.ts` sits above this and handles the
 * re-prompt path.
 *
 * `schemaMode` semantics:
 *   provider_native  — provider returned schema-valid output on first try
 *   normalize_fallback — normalizeRaw repaired the output
 *   both             — provider returned output AND normalizeRaw re-tightened it
 */

export interface StructuredOutputArgs<T> {
  provider: ProviderName;
  model: string;
  schema: z.ZodType<T>;
  messages: ProviderMessage[];
  /** Optional normalizeRaw fallback. Called when Zod validation fails. */
  normalizeRaw?: (raw: unknown) => unknown;
  thinkingBudget?: number;
  timeoutMs?: number;
}

export interface StructuredOutputResult<T> {
  value: T;
  schemaMode: SchemaMode;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
  model: string;
}

export async function callWithStructuredOutput<T>(
  args: StructuredOutputArgs<T>
): Promise<StructuredOutputResult<T>> {
  const provider = getLlmProvider(args.provider);
  const result = await provider.invoke({
    model: args.model,
    messages: args.messages,
    outputSchema: args.schema as ZodTypeAny,
    thinkingBudget: args.thinkingBudget,
    timeoutMs: args.timeoutMs,
  });

  // First attempt: validate the raw provider output directly.
  const directParse = args.schema.safeParse(result.content);
  if (directParse.success) {
    return {
      value: directParse.data,
      schemaMode: "provider_native",
      usage: result.usage,
      model: result.model,
    };
  }

  // Defense-in-depth: try normalizeRaw if provided (H1.3).
  if (args.normalizeRaw) {
    const normalized = args.normalizeRaw(result.content);
    const normalizedParse = args.schema.safeParse(normalized);
    if (normalizedParse.success) {
      // Determine whether the provider output was partially valid.
      const schemaMode: SchemaMode =
        result.schemaMode === "provider_native" ? "both" : "normalize_fallback";
      return {
        value: normalizedParse.data,
        schemaMode,
        usage: result.usage,
        model: result.model,
      };
    }
  }

  // Both paths failed — throw the original Zod error so the caller can retry.
  throw directParse.error;
}
