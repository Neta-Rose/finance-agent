import type { LlmProvider, ProviderInvokeArgs, ProviderResult } from "./index.js";

/**
 * Anthropic provider — Phase 4 stub, fully implemented in Phase 5.
 *
 * Phase 4 ships this as a stub that falls back to OpenRouter so the factory
 * compiles and the `provider` column can be set to 'anthropic' in
 * model_tier_assignments without breaking anything. The real implementation
 * (tool-use + extended thinking) lands in Phase 5 when the chat agent ships.
 */

import { OpenRouterProvider } from "./openRouterProvider.js";

export class AnthropicProvider implements LlmProvider {
  private readonly fallback = new OpenRouterProvider();

  async invoke(args: ProviderInvokeArgs): Promise<ProviderResult> {
    // Phase 5 will replace this with the real Anthropic tool-use implementation.
    return this.fallback.invoke(args);
  }
}
