import Instructor from "@instructor-ai/instructor";
import OpenAI from "openai";
import type { z } from "zod";

export interface InstructorCallResult<T> {
  value: T;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
  model: string;
}

/**
 * Calls the LLM via instructor in TOOLS mode.
 *
 * TOOLS mode sends the Zod schema as a function definition and forces the model
 * to respond via a tool_call — eliminating markdown-fenced JSON, double-
 * serialization, and root-string responses at the API level.
 *
 * A per-call custom fetch intercepts OpenRouter's non-standard `usage.cost`
 * field (which the OpenAI SDK drops), accumulating it across all retry calls so
 * cost is tracked correctly even when instructor retries on schema failure.
 *
 * On schema failure instructor retries up to maxRetries times, sending the Zod
 * error back to the model as a correction prompt. This replaces all hand-rolled
 * self-correcting retry and normalizeRaw parsing logic.
 */
export async function callWithInstructor<T>(args: {
  schema: z.ZodType<T>;
  schemaName: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxRetries?: number;
}): Promise<InstructorCallResult<T>> {
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let responseModel = "";

  const customFetch: typeof globalThis.fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init);
    // Clone before consuming so the SDK can still read the body.
    const clone = response.clone();
    try {
      const body = JSON.parse(await clone.text()) as {
        usage?: { cost?: unknown; prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const cost = Number(body.usage?.cost ?? 0);
      if (Number.isFinite(cost)) totalCostUsd += cost;
      totalTokensIn += Number(body.usage?.prompt_tokens ?? 0);
      totalTokensOut += Number(body.usage?.completion_tokens ?? 0);
      if (typeof body.model === "string" && body.model) responseModel = body.model;
    } catch {
      // Non-fatal — usage will be 0 for this call
    }
    return response;
  };

  const openai = new OpenAI({
    apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://clawd.ai",
      "X-Title": "Clawd",
    },
    fetch: customFetch,
  });

  const client = Instructor({ client: openai, mode: "TOOLS" });

  // instructor.chat.completions.create returns Promise<z.infer<Schema>> when
  // response_model is provided. Cast needed because our ZodType<T> generic
  // doesn't directly satisfy ZodTypeAny's structural constraint.
  const value = (await client.chat.completions.create({
    model: args.model,
    messages: args.messages,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response_model: { schema: args.schema as any, name: args.schemaName },
    max_retries: args.maxRetries ?? 2,
  })) as T;

  return {
    value,
    usage: {
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      costUsd: totalCostUsd,
    },
    model: responseModel || args.model,
  };
}
