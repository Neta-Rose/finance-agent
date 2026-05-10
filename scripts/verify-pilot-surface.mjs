#!/usr/bin/env node
import { readFileSync } from "node:fs";

const failures = [];
const read = (path) => readFileSync(path, "utf8");
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const settingsPath = "frontend/src/pages/Settings.tsx";
const settings = read(settingsPath);

const forbiddenSettingsPatterns = [
  ["connectWhatsApp", "Settings must not import or call the WhatsApp connection API"],
  ["disconnectWhatsApp", "Settings must not import or call the WhatsApp disconnect API"],
  ["showWhatsAppForm", "Settings must not expose a WhatsApp setup form"],
  ["handleConnectWhatsApp", "Settings must not include a WhatsApp connect handler"],
  ["handleDisconnectWhatsApp", "Settings must not include a WhatsApp disconnect handler"],
  ["value=\"whatsapp\"", "Settings must not offer WhatsApp as a selectable notification channel"],
  ["t(\"whatsapp\"", "Settings must not render WhatsApp as a pilot-facing label"],
  ["whatsAppGuideStep", "Settings must not render WhatsApp setup guidance"],
];

for (const [pattern, message] of forbiddenSettingsPatterns) {
  assert(!settings.includes(pattern), `${settingsPath}: ${message} (${pattern})`);
}

assert(
  settings.includes("whatsapp: false"),
  `${settingsPath}: notification saves must explicitly keep WhatsApp disabled for the pilot`
);
assert(
  settings.includes("sanitizePilotNotifications"),
  `${settingsPath}: persisted notification preferences must be sanitized before rendering/saving`
);

const api = read("frontend/src/api/onboarding.ts");
assert(
  api.includes("connectWhatsApp") && api.includes("disconnectWhatsApp"),
  "frontend/src/api/onboarding.ts: dormant WhatsApp API helpers should remain available but hidden from pilot UI"
);

const i18nPath = "frontend/src/store/i18n.ts";
const i18n = read(i18nPath);
const forbiddenPilotCopyPatterns = [
  ["Clawd", "Pilot-facing translations must use neutral product copy instead of old/internal product names"],
  ["finance-agent", "Pilot-facing translations must not expose internal repository or product identifiers"],
];

for (const [pattern, message] of forbiddenPilotCopyPatterns) {
  assert(!i18n.includes(pattern), `${i18nPath}: ${message} (${pattern})`);
}

const readmePath = "README.md";
const readme = read(readmePath);
const forbiddenReadmePatterns = [
  ["Clawd", "README must use neutral product copy instead of old/internal product names"],
  ["finance-agent", "README must not expose internal repository or product identifiers as product copy"],
  ["WhatsApp", "README must not promote WhatsApp as a supported pilot delivery channel"],
];

for (const [pattern, message] of forbiddenReadmePatterns) {
  assert(!readme.includes(pattern), `${readmePath}: ${message} (${pattern})`);
}

assert(
  readme.includes("Telegram or web"),
  `${readmePath}: public copy must name Web and Telegram as the pilot delivery surfaces`
);

const catalogPath = "docs/pilot-features/pilot-core.json";
let catalog;
try {
  catalog = JSON.parse(read(catalogPath));
} catch (error) {
  failures.push(`${catalogPath}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
}

const collectStrings = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
};

const whatsappDeferredPattern = /whatsapp[^.\n]*(defer|deferred|hidden|unavailable|blocked)|(?:defer|deferred|hidden|unavailable|blocked)[^.\n]*whatsapp/i;

if (catalog && Array.isArray(catalog.entries)) {
  for (const entry of catalog.entries) {
    if (entry?.pilotRecommendation !== "pilot") continue;
    const promotedWhatsAppText = collectStrings(entry).filter((text) =>
      /whatsapp/i.test(text) && !whatsappDeferredPattern.test(text)
    );
    assert(
      promotedWhatsAppText.length === 0,
      `${catalogPath}: pilot entry ${entry.id ?? "<unknown>"} must describe WhatsApp only as hidden/deferred/unavailable when mentioned`
    );
  }
} else if (catalog) {
  failures.push(`${catalogPath}: expected an object with an entries array`);
}

if (failures.length > 0) {
  console.error("Pilot surface verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Pilot surface verification passed: WhatsApp setup and notification selection are hidden from Settings, saves force WhatsApp disabled, and pilot copy stays nameless.");
