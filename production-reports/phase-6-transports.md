# Production report — Phase 6: Telegram and WhatsApp transports

**Date:** 2026-05-06
**Initiative:** Platform Stabilization and Assistant
**Tasks:** 6.1–6.6 (code), operational steps on VPS

---

## Goal

Make the same `agentChat` function reachable from Telegram and WhatsApp. Both transports are thin adapters: verify signature → resolve channel binding → call `agentChat` → deliver reply. No command parsing, no content branching.

---

## 6.1 — Channel-binding flow

`backend/src/routes/channels.ts`

`POST /api/channels/binding-codes` — issues a 6-char hex code (e.g. `A3F9C2`) stored in an in-memory map with a 15-minute TTL. The user sends `connect A3F9C2` to their Telegram or WhatsApp bot. The webhook handler calls `completeChannelBinding(code, channel, channelIdentifier)` which inserts a `channel_bindings` row.

For migrated users, Phase 1 already seeded `channel_bindings` rows from `profile.json telegramChatId` — no `/connect` needed.

---

## 6.2 — Telegram transport rewritten

`backend/src/routes/telegram.ts` — completely rewritten as a thin transport:

1. Verify `X-Telegram-Bot-Api-Secret-Token` (Phase 9 adds the strict startup guard; for now: log + reject)
2. Parse `connect <CODE>` → call `completeChannelBinding`
3. Resolve `chatId` → `userId` via `channelBindingStore.lookupByChannelId`
4. Unknown chat → write `unknown_channel` audit row, return 200
5. Call `agentChat({ userId, text, channel: 'telegram', conversationId })`
6. Persist `conversation_id` on the binding for future messages
7. Deliver reply via `deliverTelegramReply` (splits at 4096 chars)

Bot token read from `encrypted_secrets(secret_kind='telegram_bot_token')` — identity-encrypted in Phase 1, libsodium-encrypted after Phase 8.

No slash-command parsing (D1.4). No content branching.

---

## 6.3 — `telegramRouter.ts` deleted

`backend/src/services/telegramRouter.ts` deleted. Slash-command routing is gone. The chat agent owns intent.

---

## 6.4 — WhatsApp inbound webhook

`backend/src/routes/whatsapp.ts`

- `GET /api/whatsapp/webhook` — Meta webhook verification (returns `hub.challenge`)
- `POST /api/whatsapp/webhook` — inbound message handling

HMAC verification via `X-Hub-Signature-256` against the `whatsapp_app_secret` from `encrypted_secrets` (or `WHATSAPP_APP_SECRET` env fallback). Mounted before CSRF middleware.

Parses Meta Cloud API message format (`entry[0].changes[0].value.messages`). Handles `connect <CODE>` for channel binding. Routes all other messages to `agentChat`.

Backend logs a warning at startup if `WHATSAPP_VERIFY_TOKEN` is unset (strict startup guard lands Phase 9).

---

## 6.5 — Outbound WhatsApp delivery

`deliverWhatsAppMessage(userId, text)` in `whatsapp.ts` — reads `whatsapp_access_token` from `encrypted_secrets`, reads recipient phone from `channel_bindings`, calls Meta Graph API `POST /{version}/{phone}/messages`.

---

## 6.6 — Frontend: connect code widget

`frontend/src/components/ChannelConnectCode.tsx` — "Get connect code" button that calls `POST /api/channels/binding-codes` and displays the 6-char code with a copy button and expiry countdown. Can be dropped into the Settings page.

`frontend/src/api/channels.ts` — `getChannelBindingCode()` API function.

---

## Files changed

```
NEW (backend)
  backend/src/routes/telegram.ts          (rewritten — thin transport)
  backend/src/routes/whatsapp.ts          (new — inbound + outbound)
  backend/src/routes/channels.ts          (new — binding-code flow)

NEW (frontend)
  frontend/src/api/channels.ts
  frontend/src/components/ChannelConnectCode.tsx

DELETED
  backend/src/services/telegramRouter.ts

EDITED
  backend/src/app.ts                      (+ whatsapp + channels routes)
```

---

## Operational steps on VPS

### Required environment variables

Add to `/etc/systemd/system/clawd-backend.service` before deploying:

```ini
Environment="TELEGRAM_SECRET=<your-telegram-bot-api-secret-token>"
Environment="WHATSAPP_VERIFY_TOKEN=<your-whatsapp-verify-token>"
Environment="WHATSAPP_APP_SECRET=<your-meta-app-secret>"
```

```bash
systemctl daemon-reload
```

### Deploy

```bash
cd /root/clawd && ./deploy.sh
```

### Verify Telegram binding migration

```sql
-- Phase 1 migration should have seeded these from profile.json
SELECT channel, channel_identifier, user_id, bound_at
FROM channel_bindings WHERE channel = 'telegram' AND unbound_at IS NULL;
```

### Test Telegram

1. Send any message from a bound Telegram chat.
2. Verify conversation created:

```sql
SELECT id, user_id, channel, turn_count, termination_reason
FROM conversations WHERE channel = 'telegram' ORDER BY started_at DESC LIMIT 3;
```

### Register WhatsApp webhook with Meta

1. In Meta for Developers → WhatsApp → Configuration → Webhook
2. Set callback URL: `https://your-domain.com/api/whatsapp/webhook`
3. Set verify token: the value of `WHATSAPP_VERIFY_TOKEN`
4. Subscribe to `messages` field

### Bind a WhatsApp number

From the Settings page, click "Get connect code" and send `connect <CODE>` to your WhatsApp bot number.

### Rollback

Flip `chat_agent_enabled = false` to take both transports offline. The legacy Telegram slash-command path is gone after Phase 6; users on Telegram are without service until forward-roll resumes.

```sql
UPDATE feature_flags SET enabled = false, updated_at = NOW(), updated_by = 'operator'
WHERE flag_name = 'chat_agent_enabled' AND scope_user_id IS NULL;
```

---

## Deploy checkpoint recommendation

**Deploy after Phase 5, not Phase 6.** Phase 5 gives you the dashboard chat to test the `agentChat` loop end-to-end before adding two more transports. Phase 6 depends entirely on Phase 5 being correct. The security startup guards added in Phase 5 also need to be validated on the VPS before Phase 6 adds more env var requirements.

Suggested sequence:
1. Deploy Phase 5 → test dashboard chat → collect bugs
2. Fix bugs
3. Deploy Phase 6 → set `TELEGRAM_SECRET` → test Telegram → register WhatsApp webhook → test WhatsApp
4. Deploy Phase 7 (ledger, snooze, corporate actions, asset-class dispatch)
