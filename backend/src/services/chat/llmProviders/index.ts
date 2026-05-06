import type { ZodTypeAny, z } from "zod";

/**
 * LlmProvider abstraction — Phase 4, task 4.2.
 *
 * Spec: design.md §6.1 chat/llmProviders; H1.1, G1.1.
 *
 * Each provider implements the same `invoke` interface. The factory
 * `getLlmProvider` dispatches on the `provider` column from
 * `model_tier_assignments`. Phase 4 ships the OpenRouter provider (used by
 * all existing analyst steps) and stubs for Anthropic, OpenAI, and Gemini
 * (fully implemented in Phase 5 when the chat agent ships).
 */

export type SchemaMode = "provider_native" | "normalize_fallback" | "both";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderInvokeArgs {
  model: string;
  messages: ProviderMessage[];
  /** When set, the provider uses schema-bound output mode. */
  outputSchema?: ZodTypeAny;
  /** Provider-specific thinking/reasoning budget (tokens). 0 = disabled. */
  thinkingBudget?: number;
  timeoutMs?: number;
}

export interface ProviderResult {
  /** Parsed JSON object (for structured output) or raw text. */
  content: unknown;
  usage: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  model: string;
  /** Which schema enforcement path produced the result. */
  schemaMode: SchemaMode;
}

export interface LlmProvider {
  invoke(args: ProviderInvokeArgs): Promise<ProviderResult>;
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

export { OpenRouterProvider } from "./openRouterProvider.js";
export { AnthropicProvider } from "./anthropicProvider.js";
export { OpenAiProvider } from "./openAiProvider.js";
export { GeminiProvider } from "./geminiProvider.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { OpenRouterProvider } from "./openRouterProvider.js";
import { AnthropicProvider } from "./anthropicProvider.js";
import { OpenAiProvider } from "./openAiProvider.js";
import { GeminiProvider } from "./geminiProvider.js";

export type ProviderName = "openrouter" | "anthropic" | "openai" | "gemini";

export function getLlmProvider(providerName: ProviderName): LlmProvider {
  switch (providerName) {
    case "anthropic":
      return new AnthropicProvider();
    case "openai":
      return new OpenAiProvider();
    case "gemini":
      return new GeminiProvider();
    case "openrouter":
    default:
      return new OpenRouterProvider();
  }
}
