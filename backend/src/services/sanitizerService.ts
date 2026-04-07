import { logger } from "./logger.js";
import { sanitizeUserInput } from "./validationService.js";

export const SAFE_DEFLECTION =
  "I can help with portfolio analysis and research. What would you like to know about your investments?";

export interface GuardResult {
  proceed: boolean;
  message: string;
}

export function guardUserMessage(input: string): GuardResult {
  const result = sanitizeUserInput(input);

  if (result.safe) {
    return { proceed: true, message: result.sanitized };
  }

  logger.warn(
    `Input flagged | patterns=${JSON.stringify(result.flaggedPatterns)} | sanitized=${result.sanitized}`
  );

  return { proceed: false, message: SAFE_DEFLECTION };
}
