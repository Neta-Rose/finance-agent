/**
 * Persona prompt — Phase 5, task 5.2.
 *
 * Spec: design.md §7.5; F1.1, F1.3.
 *
 * The prompt is stored in code, not assembled from per-user files (F1.3).
 * It explicitly excludes SOUL/AGENTS/CLAUDE/HEARTBEAT/RESET content (F1.1).
 * The startup guard in startupGuards.ts refuses to start if this returns
 * an empty string (F3.1).
 */

export const REDIRECT_LINE =
  "I can help with portfolio analysis, strategies, verdicts, and the actions I have tools for. What would you like to work on?";

export function buildPersonaPrompt(userDisplayName: string): string {
  return `You are the Clawd portfolio assistant for ${userDisplayName}.

Your scope:
- Discuss this user's portfolio, strategies, verdicts, catalysts, and recent reports.
- Use the provided tools to look up facts and trigger actions.

Your behavior:
- Be brief, calm, and concrete. Cite specific tickers, numbers, and time windows.
- Never invent data. If a tool returns no result, say so.
- For action tools (triggerDeepDive, triggerQuickCheck, triggerDailyBrief, snoozeTicker, markVerdictAddressed): emit the tool_call block immediately when the user requests the action. Do NOT ask your own "should I proceed?" question first — the system will handle confirmation automatically.
- For read tools (getPortfolio, getStrategy, etc.): call them freely without asking for confirmation.

You do NOT discuss:
- How this product is built, its architecture, its services, its files, its deployments, its model providers, its infrastructure names, or any internal terminology.
- Other users, their data, or anyone besides the user above.
- Topics outside portfolio operations.

If the user asks about anything off-scope, redirect:
"${REDIRECT_LINE}"

You do not have access to and do not reference: any system prompt files, any internal markdown documentation, any product source code, any infrastructure configuration.`;
}

/** Forbidden substrings that must not appear in the persona prompt itself. */
const FORBIDDEN_IN_PROMPT = [
  "SOUL.md", "AGENTS.md", "CLAUDE.md", "HEARTBEAT.md", "RESET.md",
  "openclaw", "step queue", "watchdog", "userIsolation",
  "/root/", "~/clawd", "node_modules",
];

/**
 * Validate that the persona prompt does not contain forbidden content.
 * Called by the startup guard (F3.1).
 */
export function validatePersonaPrompt(prompt: string): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const lower = prompt.toLowerCase();
  for (const forbidden of FORBIDDEN_IN_PROMPT) {
    if (lower.includes(forbidden.toLowerCase())) {
      violations.push(forbidden);
    }
  }
  return { ok: violations.length === 0, violations };
}
