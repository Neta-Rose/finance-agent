#!/usr/bin/env node
import { readFileSync } from "node:fs";

const failures = [];
const read = (path) => readFileSync(path, "utf8");
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const chatPath = "frontend/src/pages/Chat.tsx";
const apiPath = "frontend/src/api/chat.ts";
const chat = read(chatPath);
const api = read(apiPath);

const requiredApiFunctions = [
  "listSavedConversations",
  "createSavedConversation",
  "getConversationHistory",
  "renameSavedConversation",
  "archiveSavedConversation",
  "sendChatMessage",
];

for (const fn of requiredApiFunctions) {
  assert(api.includes(`function ${fn}`), `${apiPath}: missing saved-chat API helper ${fn}`);
  assert(chat.includes(fn), `${chatPath}: Chat page must use ${fn}`);
}

assert(
  chat.includes('"chat_last_opened_conversation_id"'),
  `${chatPath}: Chat page must use the scoped last-opened conversation preference key`
);
assert(
  !chat.includes('"chat_session"') && !chat.includes("'chat_session'"),
  `${chatPath}: old chat_session localStorage key must be removed`
);
assert(
  !/TTL_MS|14 \* 24|14-day|14 day|savedAt|StoredSession/.test(chat),
  `${chatPath}: old browser-side message TTL/session schema must be removed`
);
assert(
  !/localStorage\.setItem\([^\n]*(JSON\.stringify|messages)/.test(chat),
  `${chatPath}: Chat page must not persist message arrays to localStorage`
);
assert(
  !/localStorage\.getItem\([^\n]*chat_session/.test(chat),
  `${chatPath}: Chat page must not read legacy stored message arrays`
);
assert(
  !/JSON\.parse\([^\n]*localStorage|localStorage[^\n]*JSON\.parse/.test(chat),
  `${chatPath}: Chat page should not parse browser-stored chat payloads`
);

const requiredControlCopy = ["New chat", "Rename", "Archive", "Save", "Cancel"];
for (const copy of requiredControlCopy) {
  assert(chat.includes(copy), `${chatPath}: missing saved-chat control copy "${copy}"`);
}

const requiredAccessibilityMarkers = [
  "aria-label=\"Saved chats\"",
  "aria-label=\"Saved conversation list\"",
  "aria-label=\"Send message\"",
  "htmlFor=\"chat-message-input\"",
  "role=\"alert\"",
];
for (const marker of requiredAccessibilityMarkers) {
  assert(chat.includes(marker), `${chatPath}: missing accessibility marker ${marker}`);
}

const requiredStates = [
  "Loading saved chats",
  "Opening saved chat",
  "Saved chats are temporarily unavailable",
  "That saved chat expired",
  "No saved chats yet",
  "Message content is unavailable",
];
for (const state of requiredStates) {
  assert(chat.includes(state), `${chatPath}: missing loading/error/empty state copy "${state}"`);
}

const forbiddenPilotCopy = ["Clawd", "OpenClaw", "Neta", "finance-agent"];
for (const pattern of forbiddenPilotCopy) {
  assert(!chat.includes(pattern), `${chatPath}: must avoid old/internal pilot-facing product name ${pattern}`);
}

assert(
  chat.includes("normalizeTurnContent") && chat.includes("turnToMessage"),
  `${chatPath}: backend turns must be defensively normalized before rendering plain text`
);
assert(
  chat.includes("queryKey: [\"chat\", \"conversations\"]") && chat.includes("queryKey: [\"chat\", \"conversation\", effectiveConversationId]"),
  `${chatPath}: saved-chat list and history must be loaded through React Query`
);
assert(
  chat.includes("clearLastOpenedConversationId()") && chat.includes("That saved chat is no longer available"),
  `${chatPath}: missing self-healing behavior for stale last-opened IDs`
);

if (failures.length > 0) {
  console.error("Saved chat UI verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Saved chat UI verification passed: Chat uses backend saved-chat APIs, keeps only a last-opened preference, exposes accessible lifecycle controls, and avoids legacy/internal copy.");
