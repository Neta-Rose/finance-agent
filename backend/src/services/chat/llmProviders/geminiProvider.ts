import type { LlmProvider, ProviderInvokeArgs, ProviderResult } from "./index.js";

/**
 * Gemini provider — Phase 4 stub, fully implemented in Phase 5.
 */

import { OpenRouterProvider } from "./openRouterProvider.js";

export class GeminiProvider implements LlmProvider {
  private readonly fallback = new OpenRouterProvider();

  async invoke(args: ProviderInvokeArgs): Promise<ProviderResult> {
    return this.fallback.invoke(args);
  }
}
