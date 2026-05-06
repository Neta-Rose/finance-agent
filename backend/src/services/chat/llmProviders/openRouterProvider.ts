import type { LlmProvider, ProviderInvokeArgs, ProviderResult } from "./index.js";

/**
 * OpenRouter provider — Phase 4.
 *
 * Used for all existing analyst steps (free/cheap/balanced tiers).
 * Sends `response_format: { type: "json_object" }` when an outputSchema is
 * provided (the schema-bound path is the Phase 4 `structuredOutputs.ts`
 * wrapper; this provider is the transport layer only).
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 300_000;

function usageFromPayload(payload: {
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
}): ProviderResult["usage"] {
  const rawCost = payload.usage?.cost;
  const costUsd =
    typeof rawCost === "number"
      ? rawCost
      : typeof rawCost === "string"
      ? Number(rawCost)
      : 0;
  return {
    tokensIn: payload.usage?.prompt_tokens ?? 0,
    tokensOut: payload.usage?.completion_tokens ?? 0,
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
  };
}

export class OpenRouterProvider implements LlmProvider {
  async invoke(args: ProviderInvokeArgs): Promise<ProviderResult> {
    const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      args.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );

    try {
      const body: Record<string, unknown> = {
        model: args.model,
        messages: args.messages,
      };
      if (args.outputSchema) {
        body["response_format"] = { type: "json_object" };
      }

      const response = await fetch(OPENROUTER_BASE, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(`OpenRouter request failed ${response.status}: ${rawText.slice(0, 500)}`);
      }

      const payload = JSON.parse(rawText) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
      };

      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter response did not include message content");

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = content;
      }

      return {
        content: parsed,
        usage: usageFromPayload(payload),
        model: payload.model ?? args.model,
        // OpenRouter uses json_object mode, not provider-native schema binding.
        // The structuredOutputs wrapper will validate and may fall back to normalizeRaw.
        schemaMode: "normalize_fallback",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
