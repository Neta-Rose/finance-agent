const TELEGRAM_ABUSE_PATTERNS = [
  /\badmin(?:istrative)?\b/i,
  /\bbackend\b/i,
  /\bfrontend\b/i,
  /\bcode(?:base)?\b/i,
  /\bserver\b/i,
  /\bdeploy\b/i,
  /\brestart\b/i,
  /\blogs?\b/i,
  /\bsystem prompt\b/i,
  /\bprompt\b/i,
  /\binstructions?\b/i,
  /\bconfiguration\b/i,
  /\bdelete (?:a|the)? ?file\b/i,
  /\brm\b/i,
  /\bcat\b/i,
  /\bls\b/i,
  /\bbash\b/i,
  /\bpython(?:3)?\b/i,
  /\bsudo\b/i,
  /\bterminal\b/i,
  /\bcommand\b/i,
  /\bshow me your\b/i,
  /\bignore previous\b/i,
  /\bact as\b/i,
  /\bworkspace\b/i,
  /\bfilesystem\b/i,
  /\bfile system\b/i,
  /\bwhat files do you have\b/i,
  /\bhow are you built\b/i,
  /\bhow do you work\b/i,
  /\bsecurity\b/i,
  /\btoken\b/i,
  /\bapi key\b/i,
  /\bpassword\b/i,
];

export function isTelegramFinancialOnlyViolation(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return TELEGRAM_ABUSE_PATTERNS.some((pattern) => pattern.test(normalized));
}
