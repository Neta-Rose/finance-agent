#!/usr/bin/env node
/**
 * S06 advisory readability verifier.
 *
 * Checks that:
 * 1. frontend/src/utils/advisory.ts exists and exports the required functions.
 * 2. The advisory utility does not contain internal product names.
 * 3. The persona prompt covers all safe advisory request classes.
 * 4. The persona prompt does not expose "Clawd" or internal paths.
 * 5. The getReportSummary tool is in the read tool allowlist.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let failures = 0;

function fail(msg) {
  console.error(`  ✖ ${msg}`);
  failures++;
}

function pass(msg) {
  console.log(`  ✔ ${msg}`);
}

async function readSrc(relPath) {
  return readFile(path.join(root, relPath), "utf-8");
}

// ── 1. advisory.ts exists and exports required symbols ──────────────────────
console.log("\n[1] Advisory utility exports");
try {
  const src = await readSrc("frontend/src/utils/advisory.ts");
  const required = [
    "verdictSentence",
    "verdictSignal",
    "isActionableVerdict",
    "confidenceExplanation",
    "confidenceLabel",
    "scoreBucket",
    "scoreBucketLabel",
    "scoreBucketEmoji",
    "scoreExplanation",
    "formatCatalyst",
    "nextCatalyst",
    "reasoningSnippet",
    "buildAdvisorySummary",
  ];
  for (const fn of required) {
    if (src.includes(`export function ${fn}`) || src.includes(`export const ${fn}`)) {
      pass(`exports ${fn}`);
    } else {
      fail(`missing export: ${fn}`);
    }
  }
} catch (err) {
  fail(`Could not read frontend/src/utils/advisory.ts: ${err.message}`);
}

// ── 2. advisory.ts does not contain internal product names ──────────────────
console.log("\n[2] Advisory utility — no internal names");
try {
  const src = await readSrc("frontend/src/utils/advisory.ts");
  const forbidden = ["Clawd", "openclaw", "step queue", "watchdog", "/root/", "finance-agent"];
  for (const term of forbidden) {
    if (src.toLowerCase().includes(term.toLowerCase())) {
      fail(`advisory.ts contains internal term: "${term}"`);
    } else {
      pass(`advisory.ts does not contain: "${term}"`);
    }
  }
} catch {
  // already reported above
}

// ── 3. Persona prompt covers safe advisory classes ───────────────────────────
console.log("\n[3] Persona prompt — safe advisory classes");
try {
  const src = await readSrc("backend/src/services/chat/personaPrompt.ts");
  const classes = ["portfolio", "verdict", "strategy", "catalyst", "report", "risk", "escalation", "notification"];
  for (const cls of classes) {
    if (src.toLowerCase().includes(cls)) {
      pass(`persona prompt mentions: ${cls}`);
    } else {
      fail(`persona prompt missing advisory class: ${cls}`);
    }
  }
} catch (err) {
  fail(`Could not read personaPrompt.ts: ${err.message}`);
}

// ── 4. Persona prompt does not expose "Clawd" ────────────────────────────────
console.log("\n[4] Persona prompt — no internal product name");
try {
  const src = await readSrc("backend/src/services/chat/personaPrompt.ts");
  // The buildPersonaPrompt function body must not contain "Clawd" as a user-visible string
  // Extract the function body (between the backtick template literal)
  const fnMatch = src.match(/export function buildPersonaPrompt[\s\S]*?return `([\s\S]*?)`;/);
  if (fnMatch) {
    const promptBody = fnMatch[1];
    if (promptBody.includes("Clawd")) {
      fail('buildPersonaPrompt template contains "Clawd" — must use neutral copy');
    } else {
      pass('buildPersonaPrompt template does not expose "Clawd"');
    }
  } else {
    fail("Could not extract buildPersonaPrompt template body for inspection");
  }
} catch (err) {
  fail(`Could not read personaPrompt.ts: ${err.message}`);
}

// ── 5. getReportSummary in read tool allowlist ───────────────────────────────
console.log("\n[5] Tool registry — getReportSummary in allowlist");
try {
  const src = await readSrc("backend/src/services/chat/tools/registry.ts");
  if (src.includes('"getReportSummary"')) {
    pass("getReportSummary is in READ_TOOL_NAMES");
  } else {
    fail("getReportSummary is missing from READ_TOOL_NAMES");
  }
} catch (err) {
  fail(`Could not read registry.ts: ${err.message}`);
}

// ── 6. Safety policy test file exists ───────────────────────────────────────
console.log("\n[6] Safety policy test file");
try {
  await readSrc("backend/src/services/chat/chatSafetyPolicy.test.ts");
  pass("chatSafetyPolicy.test.ts exists");
} catch {
  fail("chatSafetyPolicy.test.ts is missing");
}

// ── 7. Pilot surface policy still passes ────────────────────────────────────
console.log("\n[7] Pilot surface policy (WhatsApp hidden, nameless copy)");
try {
  const settingsSrc = await readSrc("frontend/src/pages/Settings.tsx");
  if (settingsSrc.includes("whatsapp") && !settingsSrc.toLowerCase().includes("whatsapp setup")) {
    // WhatsApp may appear in disabled/hidden context — check it's not shown as a setup option
    const hasSetupSection = /whatsapp.*setup|setup.*whatsapp/i.test(settingsSrc);
    if (hasSetupSection) {
      fail("Settings.tsx appears to expose WhatsApp setup — check S02 policy");
    } else {
      pass("Settings.tsx does not expose WhatsApp setup");
    }
  } else {
    pass("Settings.tsx WhatsApp policy intact");
  }
} catch (err) {
  fail(`Could not read Settings.tsx: ${err.message}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failures === 0) {
  console.log("✅ All advisory readability checks passed.");
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) failed.`);
  process.exit(1);
}
