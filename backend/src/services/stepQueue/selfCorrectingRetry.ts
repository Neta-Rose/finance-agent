import type { ZodError } from "zod";
import { isFeatureEnabled } from "../featureFlagService.js";
import { callWithStructuredOutput, type StructuredOutputArgs, type StructuredOutputResult } from "./structuredOutputs.js";

/**
 * Self-correcting retry wrapper — Phase 4, task 4.4.
 *
 * Spec: design.md §10.3; H2.1, H2.2, H2.3, H2.4.
 *
 * When `callWithStructuredOutput` throws a ZodError, this wrapper re-invokes
 * the provider exactly once with the validation error message and the
 * malformed output appended as a corrective system message.
 *
 * The combined call (original + retry) counts as ONE logical attempt against
 * the 3-attempt ceiling in the executor. The caller receives:
 *   - On success after retry: the corrected value + `selfCorrected: true`
 *   - On second failure: the ZodError from the retry (caller proceeds with
 *     normal retry/escalation behavior per H2.3)
 *
 * Gated by `feature_flags.self_correcting_retry_enabled` (default true).
 */

export interface SelfCorrectingResult<T> extends StructuredOutputResult<T> {
  /** True when the self-correcting retry was needed and succeeded. */
  selfCorrected: boolean;
}

function buildCorrectionMessages(
  originalMessages: StructuredOutputArgs<unknown>["messages"],
  malformedOutput: unknown,
  zodError: ZodError
): StructuredOutputArgs<unknown>["messages"] {
  const errorSummary = zodError.errors
    .slice(0, 5)
    .map((e) => `  ${e.path.join(".")}: ${e.message}`)
    .join("\n");

  return [
    ...originalMessages,
    {
      role: "assistant" as const,
      content: typeof malformedOutput === "string"
        ? malformedOutput
        : JSON.stringify(malformedOutput),
    },
    {
      role: "user" as const,
      content: [
        "Your previous response failed schema validation. Please correct it.",
        "",
        "Validation errors:",
        errorSummary,
        "",
        "Return only the corrected JSON object matching the required schema.",
        "Do not include any explanation or markdown.",
      ].join("\n"),
    },
  ];
}

export async function callWithSelfCorrectingRetry<T>(
  args: StructuredOutputArgs<T>
): Promise<SelfCorrectingResult<T>> {
  // First attempt
  let firstError: ZodError | null = null;
  let malformedOutput: unknown = null;

  try {
    const result = await callWithStructuredOutput(args);
    return { ...result, selfCorrected: false };
  } catch (err) {
    if (!(err instanceof Error) || err.name !== "ZodError") throw err;
    firstError = err as ZodError;
    // We need the raw output to include in the correction prompt.
    // The structuredOutputs module throws the ZodError but we can't recover
    // the raw content from it. We re-invoke the provider directly to get it.
    // This is acceptable because the combined call counts as one attempt.
    try {
      const provider = (await import("../chat/llmProviders/index.js")).getLlmProvider(args.provider);
      const rawResult = await provider.invoke({
        model: args.model,
        messages: args.messages,
        outputSchema: args.schema,
        ...(args.thinkingBudget !== undefined ? { thinkingBudget: args.thinkingBudget } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
      });
      malformedOutput = rawResult.content;
    } catch {
      // If we can't get the raw output, throw the original error.
      throw firstError;
    }
  }

  // Check feature flag before retrying
  const retryEnabled = await isFeatureEnabled("self_correcting_retry_enabled");
  if (!retryEnabled) throw firstError;

  // Self-correcting retry (H2.1)
  const correctionMessages = buildCorrectionMessages(
    args.messages,
    malformedOutput,
    firstError
  );

  try {
    const retryResult = await callWithStructuredOutput({
      ...args,
      messages: correctionMessages,
    });
    return { ...retryResult, selfCorrected: true };
  } catch (retryErr) {
    // Second failure — return the retry error so the executor counts this
    // combined call as one failed attempt (H2.3).
    throw retryErr;
  }
}
