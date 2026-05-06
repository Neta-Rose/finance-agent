import { randomUUID } from "crypto";
import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../../db/applicationDataSource.js";
import { getFeatureValue } from "../featureFlagService.js";
import { REDIRECT_LINE } from "./personaPrompt.js";
import { logger } from "../logger.js";

/**
 * Output filter — Phase 5, task 5.3.
 *
 * Spec: design.md §7.6; F2.1, F2.2, F2.3, F2.4.
 *
 * Runs on every tool result before returning to the model AND on every final
 * reply before returning to the transport (F2.2).
 *
 * On a `final_reply` match the entire message is replaced with the redirect
 * line — this prevents the leak in any partial form. On a `tool_result` match
 * the offending substring is removed and the result still flows back to the
 * model so it can recover.
 *
 * Each substitution writes one `output_filter_events` row (F2.3).
 */

export type FilterSite = "tool_result" | "final_reply";

export interface FilterContext {
  conversationId: string;
  turnIndex: number;
  site: FilterSite;
}

export interface FilterResult {
  text: string;
  substitutions: Array<{ pattern: string; originalLength: number }>;
}

// ---------------------------------------------------------------------------
// Static patterns — always active regardless of feature flags.
// These cover the most sensitive internal terms.
// ---------------------------------------------------------------------------

const STATIC_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bstep[- ]queue\b/gi, label: "step queue" },
  { pattern: /\bopenclaw\b/gi, label: "openclaw" },
  { pattern: /\bwatchdog\b/gi, label: "watchdog" },
  { pattern: /\buserisolation\b/gi, label: "userIsolation" },
  // File path patterns
  { pattern: /[/~]root\/clawd[/A-Za-z0-9_./-]*/g, label: "clawd_path" },
  { pattern: /\/root\/\.openclaw[/A-Za-z0-9_./-]*/g, label: "openclaw_path" },
  { pattern: /users\/[A-Za-z0-9_-]+\/data[/A-Za-z0-9_./-]*/g, label: "user_data_path" },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Main filter function
// ---------------------------------------------------------------------------

export async function filterText(input: string, ctx: FilterContext): Promise<FilterResult> {
  const subs: FilterResult["substitutions"] = [];
  let out = input;

  // 1. Static patterns
  for (const { pattern, label } of STATIC_PATTERNS) {
    out = out.replace(pattern, (match) => {
      subs.push({ pattern: label, originalLength: match.length });
      return "";
    });
  }

  // 2. Dynamic patterns from feature_flags.forbidden_pattern_list
  try {
    const dynamic = await getFeatureValue<string[]>("forbidden_pattern_list") ?? [];
    for (const term of dynamic) {
      if (!term || typeof term !== "string") continue;
      const re = new RegExp(escapeRegExp(term), "gi");
      out = out.replace(re, (match) => {
        subs.push({ pattern: term, originalLength: match.length });
        return "";
      });
    }
  } catch (err) {
    logger.warn(`output_filter: failed to load dynamic patterns: ${(err as Error).message}`);
  }

  // 3. On final_reply with any substitution, replace the whole message.
  if (subs.length > 0 && ctx.site === "final_reply") {
    out = REDIRECT_LINE;
  }

  // 4. Persist substitution events
  if (subs.length > 0 && isApplicationDatabaseConfigured()) {
    try {
      const ds = await getApplicationDataSource();
      for (const sub of subs) {
        await ds.query(
          `INSERT INTO output_filter_events
             (id, conversation_id, turn_index, pattern, site_of_match, original_length_chars, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            randomUUID(),
            ctx.conversationId,
            ctx.turnIndex,
            sub.pattern.slice(0, 128),
            ctx.site,
            sub.originalLength,
          ]
        );
      }
    } catch (err) {
      logger.warn(`output_filter: failed to persist events: ${(err as Error).message}`);
    }
  }

  return {
    text: (out.trim() || REDIRECT_LINE),
    substitutions: subs,
  };
}

/**
 * Convenience wrapper for tool results — returns the filtered string only.
 * Tool results that trigger substitutions still flow back to the model (F2.2).
 */
export async function filterToolResult(
  result: unknown,
  ctx: FilterContext
): Promise<unknown> {
  if (typeof result !== "string") {
    // For non-string results (objects), serialize, filter, re-parse.
    const serialized = JSON.stringify(result);
    const filtered = await filterText(serialized, ctx);
    if (filtered.substitutions.length === 0) return result;
    try {
      return JSON.parse(filtered.text);
    } catch {
      return filtered.text;
    }
  }
  const filtered = await filterText(result, ctx);
  return filtered.text;
}

/**
 * Check whether the forbidden-pattern list is non-empty.
 * Used by the startup guard (F3.3).
 */
export async function isForbiddenPatternListPopulated(): Promise<boolean> {
  try {
    const dynamic = await getFeatureValue<string[]>("forbidden_pattern_list") ?? [];
    return dynamic.length > 0 || STATIC_PATTERNS.length > 0;
  } catch {
    return STATIC_PATTERNS.length > 0;
  }
}
