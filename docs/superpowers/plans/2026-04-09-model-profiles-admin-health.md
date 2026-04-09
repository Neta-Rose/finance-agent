# Model Profiles & Agent Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-user embedded model profile definitions with a single global registry, add admin CRUD for profiles and per-user profile assignment, and surface agent model failures visibly to both admin and users.

**Architecture:** A new `profileService.ts` owns `data/model-profiles.json` (global registry). Per-user `config.json` stores only `{ modelProfile: "testing" }`. `agentService.ts` gains `getUserAgentHealth()` reading openclaw's cron state. Admin routes grow profile CRUD + user profile switch. The frontend Admin page gets a Profiles section and health badges per user. `ProtectedRoute` in `App.tsx` shows a sticky banner when `agentHealthy` is false.

**Tech Stack:** Node.js/Express, TypeScript, Zod, React 18, Tailwind v4, React Query, axios

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `data/model-profiles.json` | **Create** | Global profile registry (source of truth) |
| `backend/src/schemas/profile.ts` | **Create** | Zod schemas for `ProfileDefinition` and `ProfilesRegistry` |
| `backend/src/services/profileService.ts` | **Create** | Registry I/O + user config read/write |
| `backend/src/services/agentService.ts` | **Modify** | Add `getUserAgentHealth()` |
| `backend/src/services/workspaceService.ts` | **Modify** | Strip embedded `profiles` block from `createUserWorkspace` |
| `backend/src/routes/admin.ts` | **Modify** | Add 5 new routes; enrich `GET /users` response |
| `backend/src/routes/onboarding.ts` | **Modify** | Add `agentHealthy` field to `GET /status` response |
| `frontend/src/types/api.ts` | **Modify** | Add `agentHealthy` to `OnboardStatus`; add `AgentHealth` type |
| `frontend/src/api/admin.ts` | **Modify** | Add `AgentHealth`, `ProfileDefinition`, `ProfilesRegistry` types + 5 API functions |
| `frontend/src/pages/Admin.tsx` | **Modify** | Profile management section + per-user profile badge + health badge |
| `frontend/src/App.tsx` | **Modify** | Agent health banner in `ProtectedRoute` |

---

### Task 1: Create global model-profiles.json

**Files:**
- Create: `data/model-profiles.json`

- [ ] **Step 1: Write the registry file**

```bash
cat > /root/clawd/data/model-profiles.json << 'EOF'
{
  "testing": {
    "orchestrator": "deepseek-v3",
    "analysts": "gemini-flash-lite",
    "risk": "gemini-flash-lite",
    "researchers": "deepseek-v3"
  },
  "production": {
    "orchestrator": "claude-opus",
    "analysts": "claude-sonnet",
    "risk": "claude-haiku",
    "researchers": "claude-opus"
  },
  "free": {
    "orchestrator": "meta-llama/llama-3.3-70b-instruct:free",
    "analysts": "google/gemma-3-27b-it:free",
    "risk": "google/gemma-3-27b-it:free",
    "researchers": "meta-llama/llama-3.3-70b-instruct:free"
  }
}
EOF
```

- [ ] **Step 2: Verify it is valid JSON**

```bash
python3 -c "import json; d=json.load(open('/root/clawd/data/model-profiles.json')); print(list(d.keys()))"
```
Expected output: `['testing', 'production', 'free']`

- [ ] **Step 3: Commit**

```bash
cd /root/clawd
git add data/model-profiles.json
git commit -m "feat: add global model-profiles registry with testing/production/free profiles"
```

---

### Task 2: Zod schema — `backend/src/schemas/profile.ts`

**Files:**
- Create: `backend/src/schemas/profile.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// backend/src/schemas/profile.ts
import { z } from "zod";

export const ProfileDefinitionSchema = z.object({
  orchestrator: z.string().min(1),
  analysts: z.string().min(1),
  risk: z.string().min(1),
  researchers: z.string().min(1),
});

export const ProfilesRegistrySchema = z.record(
  z.string().regex(/^[a-z0-9-]{2,32}$/, "Profile name must be 2-32 lowercase alphanumeric or hyphens"),
  ProfileDefinitionSchema
);

export const UserConfigSchema = z.object({
  modelProfile: z.string().min(1),
});

export type ProfileDefinition = z.infer<typeof ProfileDefinitionSchema>;
export type ProfilesRegistry = z.infer<typeof ProfilesRegistrySchema>;
export type UserConfig = z.infer<typeof UserConfigSchema>;
```

- [ ] **Step 2: Export from schema index**

In `backend/src/schemas/index.ts`, add at the top of the existing exports:

```typescript
export {
  ProfileDefinitionSchema,
  ProfilesRegistrySchema,
  UserConfigSchema,
} from "./profile.js";
export type { ProfileDefinition, ProfilesRegistry, UserConfig } from "./profile.js";
```

- [ ] **Step 3: Verify TypeScript compiles (no build needed, just type-check)**

```bash
cd /root/clawd/backend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 4: Commit**

```bash
cd /root/clawd
git add backend/src/schemas/profile.ts backend/src/schemas/index.ts
git commit -m "feat: add Zod schemas for model profile registry"
```

---

### Task 3: `profileService.ts` — global registry + user config I/O

**Files:**
- Create: `backend/src/services/profileService.ts`

- [ ] **Step 1: Write the service**

```typescript
// backend/src/services/profileService.ts
import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";
import {
  ProfileDefinitionSchema,
  ProfilesRegistrySchema,
} from "../schemas/profile.js";
import type { ProfileDefinition, ProfilesRegistry } from "../schemas/profile.js";

const DATA_DIR = process.env["DATA_DIR"] ?? "../data";
const USERS_DIR = process.env["USERS_DIR"] ?? "../users";

function registryPath(): string {
  return path.resolve(path.join(process.cwd(), DATA_DIR, "model-profiles.json"));
}

function userConfigPath(userId: string): string {
  return path.resolve(path.join(process.cwd(), USERS_DIR, userId, "data", "config.json"));
}

// ── Registry I/O ─────────────────────────────────────────────────────────────

export async function listProfiles(): Promise<ProfilesRegistry> {
  try {
    const raw = await fs.readFile(registryPath(), "utf-8");
    const parsed = ProfilesRegistrySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn("model-profiles.json failed validation — returning raw");
      return JSON.parse(raw) as ProfilesRegistry;
    }
    return parsed.data;
  } catch {
    logger.warn("model-profiles.json not found — returning empty registry");
    return {};
  }
}

export async function getProfile(name: string): Promise<ProfileDefinition | null> {
  const registry = await listProfiles();
  return registry[name] ?? null;
}

export async function createProfile(name: string, def: ProfileDefinition): Promise<void> {
  const validName = /^[a-z0-9-]{2,32}$/.test(name);
  if (!validName) throw new Error("Profile name must be 2-32 lowercase alphanumeric or hyphens");

  ProfileDefinitionSchema.parse(def); // throws ZodError if invalid

  const registry = await listProfiles();
  if (registry[name]) throw new Error(`Profile already exists: ${name}`);

  registry[name] = def;
  await fs.writeFile(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
  logger.info(`Created profile: ${name}`);
}

export async function updateProfile(name: string, def: ProfileDefinition): Promise<void> {
  ProfileDefinitionSchema.parse(def);

  const registry = await listProfiles();
  if (!registry[name]) throw new Error(`Profile not found: ${name}`);

  registry[name] = def;
  await fs.writeFile(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
  logger.info(`Updated profile: ${name}`);
}

export async function deleteProfile(name: string): Promise<void> {
  const registry = await listProfiles();
  if (!registry[name]) throw new Error(`Profile not found: ${name}`);

  // Ensure no user is currently on this profile
  let userIds: string[] = [];
  try {
    const entries = await fs.readdir(path.resolve(path.join(process.cwd(), USERS_DIR)), { withFileTypes: true });
    userIds = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch { /* ignore if users dir missing */ }

  const usersOnProfile: string[] = [];
  for (const userId of userIds) {
    const active = await getUserProfile(userId);
    if (active === name) usersOnProfile.push(userId);
  }
  if (usersOnProfile.length > 0) {
    throw new Error(`Cannot delete profile "${name}" — ${usersOnProfile.length} user(s) still on it: ${usersOnProfile.join(", ")}`);
  }

  delete registry[name];
  await fs.writeFile(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
  logger.info(`Deleted profile: ${name}`);
}

// ── Per-user config ───────────────────────────────────────────────────────────

export async function getUserProfile(userId: string): Promise<string> {
  try {
    const raw = await fs.readFile(userConfigPath(userId), "utf-8");
    const parsed = JSON.parse(raw) as { modelProfile?: string };
    return parsed.modelProfile ?? "testing";
  } catch {
    return "testing";
  }
}

export async function setUserProfile(userId: string, profileName: string): Promise<void> {
  const profile = await getProfile(profileName);
  if (!profile) throw new Error(`Profile not found: ${profileName}`);

  // Write clean config — strips any legacy embedded profiles block
  const config = { modelProfile: profileName };
  await fs.writeFile(userConfigPath(userId), JSON.stringify(config, null, 2), "utf-8");
  logger.info(`Set profile for ${userId}: ${profileName}`);
}
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/backend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /root/clawd
git add backend/src/services/profileService.ts
git commit -m "feat: add profileService for global registry and per-user config I/O"
```

---

### Task 4: Add `getUserAgentHealth()` to `agentService.ts`

**Files:**
- Modify: `backend/src/services/agentService.ts`

- [ ] **Step 1: Add the interface and function**

At the bottom of `backend/src/services/agentService.ts` (after the `getUserAgentStatus` function), add:

```typescript
export interface AgentHealth {
  healthy: boolean;
  consecutiveErrors: number;
  lastError: string | null;
  lastRunAt: string | null;
}

const CRON_JOBS_PATH = "/root/.openclaw/cron/jobs.json";
const HEALTH_ERROR_THRESHOLD = 10;

export async function getUserAgentHealth(userId: string): Promise<AgentHealth> {
  try {
    const raw = await fs.readFile(CRON_JOBS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as {
      jobs?: Array<{
        name?: string;
        agentId?: string;
        state?: {
          consecutiveErrors?: number;
          lastError?: string;
          lastRunAtMs?: number;
        };
      }>;
    };
    const jobs = parsed.jobs ?? [];
    const cronJob = jobs.find(
      (j) => j.name === `${userId}-heartbeat` || j.agentId === userId
    );
    if (!cronJob?.state) {
      return { healthy: true, consecutiveErrors: 0, lastError: null, lastRunAt: null };
    }
    const { consecutiveErrors = 0, lastError, lastRunAtMs } = cronJob.state;
    return {
      healthy: consecutiveErrors < HEALTH_ERROR_THRESHOLD,
      consecutiveErrors,
      lastError: lastError ?? null,
      lastRunAt: lastRunAtMs ? new Date(lastRunAtMs).toISOString() : null,
    };
  } catch {
    // cron file missing or unreadable — assume healthy (no errors yet)
    return { healthy: true, consecutiveErrors: 0, lastError: null, lastRunAt: null };
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/backend
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /root/clawd
git add backend/src/services/agentService.ts
git commit -m "feat: add getUserAgentHealth() reading cron consecutive error state"
```

---

### Task 5: Update `workspaceService.ts` — remove embedded profiles

**Files:**
- Modify: `backend/src/services/workspaceService.ts`

- [ ] **Step 1: Replace the embedded config block**

In `backend/src/services/workspaceService.ts`, find lines 83–104 (the `const config = { ... }` block and `writeFile` call) and replace with:

```typescript
  const config = { modelProfile: "testing" };
  await fs.writeFile(
    ws.configFile,
    JSON.stringify(config, null, 2),
    "utf-8"
  );
```

The old block being replaced looks like:
```typescript
  const config = {
    modelProfile: "testing",
    profiles: {
      testing: {
        orchestrator: "deepseek-v3",
        analysts: "gemini-flash-lite",
        risk: "gemini-flash-lite",
        researchers: "deepseek-v3",
      },
      production: {
        orchestrator: "claude-opus",
        analysts: "claude-sonnet",
        risk: "claude-haiku",
        researchers: "claude-opus",
      },
    },
  };
  await fs.writeFile(
    ws.configFile,
    JSON.stringify(config, null, 2),
    "utf-8"
  );
```

- [ ] **Step 2: Type-check**

```bash
cd /root/clawd/backend
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /root/clawd
git add backend/src/services/workspaceService.ts
git commit -m "feat: new workspaces write lean config.json — profile name only, no embedded definitions"
```

---

### Task 6: Admin routes — profile CRUD + enrich user list

**Files:**
- Modify: `backend/src/routes/admin.ts`

- [ ] **Step 1: Add imports at the top of `admin.ts`**

After the existing imports, add:

```typescript
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  getUserProfile,
  setUserProfile,
} from "../services/profileService.js";
import { getUserAgentHealth } from "../services/agentService.js";
import type { AgentHealth } from "../services/agentService.js";
import type { ProfileDefinition, ProfilesRegistry } from "../schemas/profile.js";
```

- [ ] **Step 2: Enrich `GET /users` to include `modelProfile` and `agentHealth`**

In the `GET /users` handler, inside the `Promise.all` `map` callback, after the `agentStatus` line add:

```typescript
        const modelProfile = await getUserProfile(userId);
        const agentHealth = await getUserAgentHealth(userId);
```

Then update the return object to include:
```typescript
        return {
          userId,
          displayName,
          state,
          portfolioLoaded,
          agentConfigured: agentStatus.configured,
          hasTelegram: agentStatus.hasTelegram,
          telegramChatId: agentStatus.telegramChatId,
          createdAt,
          rateLimits,
          schedule,
          modelProfile,
          agentHealth,
        };
```

- [ ] **Step 3: Add profile routes**

Before `export default router;` at the bottom of `admin.ts`, add all five profile routes:

```typescript
// GET /api/admin/profiles
router.get(
  "/profiles",
  handler(async (_req, res) => {
    const profiles = await listProfiles();
    res.json({ profiles });
  })
);

// POST /api/admin/profiles
router.post(
  "/profiles",
  handler(async (req, res) => {
    const body = req.body as { name?: string; definition?: ProfileDefinition };
    const name = String(body.name ?? "").trim();
    const def = body.definition;
    if (!name || !def) {
      res.status(400).json({ error: "name and definition required" });
      return;
    }
    try {
      await createProfile(name, def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create profile";
      const status = msg.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.status(201).json({ created: true, name });
  })
);

// PATCH /api/admin/profiles/:name
router.patch(
  "/profiles/:name",
  handler(async (req, res) => {
    const name = req.params.name as string;
    const def = req.body as ProfileDefinition;
    try {
      await updateProfile(name, def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update profile";
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ updated: true, name });
  })
);

// DELETE /api/admin/profiles/:name
router.delete(
  "/profiles/:name",
  handler(async (req, res) => {
    const name = req.params.name as string;
    try {
      await deleteProfile(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete profile";
      const status = msg.includes("not found") ? 404 : msg.includes("still on it") ? 409 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ deleted: true, name });
  })
);

// PATCH /api/admin/users/:userId/profile
router.patch(
  "/users/:userId/profile",
  handler(async (req, res) => {
    const userId = req.params.userId as string;
    if (!userId) { res.status(400).json({ error: "userId required" }); return; }
    const { profileName } = req.body as { profileName?: string };
    if (!profileName) { res.status(400).json({ error: "profileName required" }); return; }
    try {
      await setUserProfile(userId, profileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set profile";
      const status = msg.includes("not found") ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    res.json({ updated: true, userId, profileName });
  })
);
```

- [ ] **Step 4: Type-check**

```bash
cd /root/clawd/backend
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Verify routes manually**

```bash
cd /root/clawd && npx tsx backend/src/server.ts &
sleep 2
curl -s -H "X-Admin-Key: ${ADMIN_KEY}" http://localhost:8081/api/admin/profiles | python3 -m json.tool
kill %1
```
Expected: `{ "profiles": { "testing": {...}, "production": {...}, "free": {...} } }`

- [ ] **Step 6: Commit**

```bash
cd /root/clawd
git add backend/src/routes/admin.ts
git commit -m "feat: admin profile CRUD routes + modelProfile/agentHealth in user list"
```

---

### Task 7: Add `agentHealthy` to onboarding status

**Files:**
- Modify: `backend/src/routes/onboarding.ts`

- [ ] **Step 1: Add import**

At the top of `backend/src/routes/onboarding.ts`, add to the imports from agentService:

```typescript
import { updateUserTelegram, restartGateway, getUserAgentHealth } from "../services/agentService.js";
```

- [ ] **Step 2: Add health check in `GET /status` handler**

In the `GET /status` handler, after `const rateLimits = ...` line (around line 233) and before `res.json(...)`, add:

```typescript
    const agentHealth = await getUserAgentHealth(userId);
```

- [ ] **Step 3: Add `agentHealthy` to the response object**

In the `res.json({...})` call, add:

```typescript
      agentHealthy: agentHealth.healthy,
```

The full response object should now be:
```typescript
    res.json({
      userId,
      state: stateData.state,
      displayName: profile?.displayName ?? null,
      telegramChatId: profile?.telegramChatId ?? null,
      bootstrapProgress,
      portfolioLoaded,
      readyForTrading: stateData.state === "ACTIVE",
      rateLimits,
      schedule: profile?.schedule ?? null,
      telegramConnected: !!profile?.telegramChatId,
      agentHealthy: agentHealth.healthy,
    });
```

- [ ] **Step 4: Type-check**

```bash
cd /root/clawd/backend
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
cd /root/clawd
git add backend/src/routes/onboarding.ts
git commit -m "feat: expose agentHealthy in onboard status response"
```

---

### Task 8: Frontend types — add `agentHealthy` and `AgentHealth`

**Files:**
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Add `AgentHealth` interface**

In `frontend/src/types/api.ts`, add after the `RateLimits` interface:

```typescript
export interface AgentHealth {
  healthy: boolean;
  consecutiveErrors: number;
  lastError: string | null;
  lastRunAt: string | null;
}
```

- [ ] **Step 2: Add `agentHealthy` to `OnboardStatus`**

In the `OnboardStatus` interface, add after `telegramConnected`:

```typescript
  agentHealthy: boolean;
```

- [ ] **Step 3: Commit**

```bash
cd /root/clawd
git add frontend/src/types/api.ts
git commit -m "feat: add AgentHealth type and agentHealthy to OnboardStatus"
```

---

### Task 9: Frontend admin API — profile functions and enriched types

**Files:**
- Modify: `frontend/src/api/admin.ts`

- [ ] **Step 1: Add types**

After the existing `AdminStatus` interface, add:

```typescript
export interface ProfileDefinition {
  orchestrator: string;
  analysts: string;
  risk: string;
  researchers: string;
}

export type ProfilesRegistry = Record<string, ProfileDefinition>;

export interface AgentHealth {
  healthy: boolean;
  consecutiveErrors: number;
  lastError: string | null;
  lastRunAt: string | null;
}
```

- [ ] **Step 2: Update `UserSummary` interface**

Add two fields to the existing `UserSummary` interface:

```typescript
export interface UserSummary {
  userId: string;
  displayName: string;
  state: string;
  portfolioLoaded: boolean;
  agentConfigured: boolean;
  hasTelegram: boolean;
  telegramChatId?: string;
  createdAt: string;
  rateLimits: RateLimits;
  schedule: Schedule;
  modelProfile: string;
  agentHealth: AgentHealth;
}
```

- [ ] **Step 3: Add profile API functions**

After `adminGetStatus`, add:

```typescript
export const adminFetchProfiles = async (): Promise<{ profiles: ProfilesRegistry }> =>
  adminFetch("/api/admin/profiles");

export const adminCreateProfile = async (name: string, definition: ProfileDefinition): Promise<void> => {
  await adminFetch("/api/admin/profiles", {
    method: "POST",
    body: JSON.stringify({ name, definition }),
  });
};

export const adminUpdateProfile = async (name: string, definition: ProfileDefinition): Promise<void> => {
  await adminFetch(`/api/admin/profiles/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify(definition),
  });
};

export const adminDeleteProfile = async (name: string): Promise<void> => {
  await adminFetch(`/api/admin/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
};

export const adminSetUserProfile = async (userId: string, profileName: string): Promise<void> => {
  await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}/profile`, {
    method: "PATCH",
    body: JSON.stringify({ profileName }),
  });
};
```

- [ ] **Step 4: Commit**

```bash
cd /root/clawd
git add frontend/src/api/admin.ts
git commit -m "feat: add profile API functions and enrich UserSummary with modelProfile/agentHealth"
```

---

### Task 10: Admin.tsx — profiles section and per-user profile/health badges

**Files:**
- Modify: `frontend/src/pages/Admin.tsx`

This task modifies a large file. Make all changes carefully and sequentially.

- [ ] **Step 1: Add profile imports**

At the top of `Admin.tsx`, add to the existing import from `../api/admin`:

```typescript
import {
  adminFetchUsers,
  adminCreateUser,
  adminDeleteUser,
  adminUpdateLimits,
  adminAddTelegram,
  adminGetStatus,
  adminFetchProfiles,
  adminCreateProfile,
  adminUpdateProfile,
  adminDeleteProfile,
  adminSetUserProfile,
  type UserSummary,
  type RateLimits,
  type AdminStatus,
  type ProfileDefinition,
  type ProfilesRegistry,
} from "../api/admin";
```

- [ ] **Step 2: Add `ProfileEditor` component**

Add this component before the `AdminLogin` component:

```typescript
// ---- Profile Editor (inline form) ----
function ProfileEditor({
  name,
  initial,
  onSave,
  onCancel,
}: {
  name: string;
  initial: ProfileDefinition;
  onSave: (def: ProfileDefinition) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ProfileDefinition>({ ...initial });
  const fields: Array<{ key: keyof ProfileDefinition; label: string }> = [
    { key: "orchestrator", label: "Orchestrator" },
    { key: "analysts", label: "Analysts" },
    { key: "risk", label: "Risk" },
    { key: "researchers", label: "Researchers" },
  ];
  return (
    <div className="space-y-2 pt-1">
      {fields.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-[var(--color-fg-muted)]">{label}</span>
          <input
            value={draft[key]}
            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            className="flex-1 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
            placeholder={`model id for ${label.toLowerCase()}`}
          />
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 py-1.5 rounded border border-[var(--color-border)] text-xs text-[var(--color-fg-muted)]">Cancel</button>
        <button
          onClick={() => onSave(draft)}
          className="flex-1 py-1.5 rounded bg-[var(--color-accent-blue)] text-white text-xs font-semibold"
        >Save</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `ProfilesSection` component**

Add this component before the `AddUserModal` component:

```typescript
// ---- Profiles Section ----
function ProfilesSection({ onError }: { onError: (msg: string) => void }) {
  const [profiles, setProfiles] = useState<ProfilesRegistry>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDef, setNewDef] = useState<ProfileDefinition>({ orchestrator: "", analysts: "", risk: "", researchers: "" });

  const load = useCallback(async () => {
    try {
      const { profiles: p } = await adminFetchProfiles();
      setProfiles(p);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load profiles");
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const handleUpdate = async (name: string, def: ProfileDefinition) => {
    try {
      await adminUpdateProfile(name, def);
      setEditing(null);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to update profile");
    }
  };

  const handleCreate = async () => {
    try {
      await adminCreateProfile(newName.trim(), newDef);
      setAdding(false);
      setNewName("");
      setNewDef({ orchestrator: "", analysts: "", risk: "", researchers: "" });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to create profile");
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete profile "${name}"? This cannot be undone.`)) return;
    try {
      await adminDeleteProfile(name);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete profile");
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-[var(--color-fg-default)]">Model Profiles</h2>
        <button
          onClick={() => setAdding(true)}
          className="text-xs px-3 py-1 rounded-lg bg-[var(--color-accent-blue)] text-white font-semibold"
        >+ Add Profile</button>
      </div>
      <div className="space-y-2">
        {Object.entries(profiles).map(([name, def]) => (
          <div key={name} className="bg-[var(--color-bg-subtle)] rounded-xl px-4 py-3 border border-[var(--color-border)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-fg-default)]">{name}</span>
              <div className="flex gap-2">
                <button onClick={() => setEditing(editing === name ? null : name)}
                  className="text-xs text-[var(--color-accent-blue)]">
                  {editing === name ? "Cancel" : "Edit"}
                </button>
                <button onClick={() => handleDelete(name)}
                  className="text-xs text-[var(--color-accent-red)]">Delete</button>
              </div>
            </div>
            {editing !== name && (
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                {(["orchestrator", "analysts", "risk", "researchers"] as const).map((k) => (
                  <span key={k} className="text-xs text-[var(--color-fg-muted)]">
                    <span className="text-[var(--color-fg-subtle)]">{k}: </span>{def[k]}
                  </span>
                ))}
              </div>
            )}
            {editing === name && (
              <div className="mt-2">
                <ProfileEditor name={name} initial={def} onSave={(d) => handleUpdate(name, d)} onCancel={() => setEditing(null)} />
              </div>
            )}
          </div>
        ))}
        {adding && (
          <div className="bg-[var(--color-bg-subtle)] rounded-xl px-4 py-3 border border-[var(--color-accent-blue)]">
            <div className="mb-2">
              <label className="text-xs text-[var(--color-fg-muted)] block mb-1">Profile Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. budget"
                className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
              />
            </div>
            <ProfileEditor
              name={newName}
              initial={newDef}
              onSave={(d) => { setNewDef(d); void handleCreate(); }}
              onCancel={() => { setAdding(false); setNewName(""); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add profile badge and health badge to each user card**

Inside the main `AdminPanel` component (or wherever user cards are rendered), find where user info is displayed per user and add:

1. **Profile badge** with switch dropdown — add a `ProfileBadge` component:

```typescript
// ---- Profile Badge (per-user) ----
function ProfileBadge({
  userId,
  current,
  profiles,
  onChanged,
  onError,
}: {
  userId: string;
  current: string;
  profiles: ProfilesRegistry;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const colors: Record<string, string> = {
    testing: "bg-blue-500/20 text-blue-400",
    production: "bg-green-500/20 text-green-400",
    free: "bg-gray-500/20 text-gray-400",
  };
  const colorClass = colors[current] ?? "bg-purple-500/20 text-purple-400";

  const handleSwitch = async (name: string) => {
    setOpen(false);
    try {
      await adminSetUserProfile(userId, name);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to switch profile");
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}
      >
        {current} ▾
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-20 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[120px]">
          {Object.keys(profiles).map((name) => (
            <button
              key={name}
              onClick={() => handleSwitch(name)}
              className={`w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--color-bg-muted)] ${name === current ? "font-bold text-[var(--color-accent-blue)]" : "text-[var(--color-fg-default)]"}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

2. **Health badge** — add a `HealthBadge` component:

```typescript
// ---- Health Badge (per-user) ----
function HealthBadge({ health }: { health: UserSummary["agentHealth"] }) {
  if (health.healthy) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">OK</span>;
  }
  const tooltip = health.lastError
    ? health.lastError.slice(0, 160)
    : `${health.consecutiveErrors} consecutive errors`;
  return (
    <span
      title={tooltip}
      className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium cursor-help"
    >
      Error ⚠
    </span>
  );
}
```

- [ ] **Step 5: Wire `ProfilesSection` and badges into `AdminPanel`**

In the main `AdminPanel` component:

1. Fetch profiles alongside users by adding a `profiles` state and calling `adminFetchProfiles()` in `load()`:

```typescript
  const [profiles, setProfiles] = useState<ProfilesRegistry>({});

  const load = useCallback(async () => {
    try {
      const [{ users: u }, { profiles: p }, status] = await Promise.all([
        adminFetchUsers(),
        adminFetchProfiles(),
        adminGetStatus(),
      ]);
      setUsers(u);
      setProfiles(p);
      setStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
```

2. Render `<ProfilesSection>` above the user list:

```tsx
<ProfilesSection onError={setError} />
```

3. Inside each user card, render the two badges (find the section where `hasTelegram`, `state` etc. are shown):

```tsx
<ProfileBadge
  userId={user.userId}
  current={user.modelProfile}
  profiles={profiles}
  onChanged={load}
  onError={setError}
/>
<HealthBadge health={user.agentHealth} />
```

- [ ] **Step 6: Commit**

```bash
cd /root/clawd
git add frontend/src/pages/Admin.tsx
git commit -m "feat: admin panel — model profiles section + per-user profile badge and health badge"
```

---

### Task 11: Health banner in `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add the banner to `ProtectedRoute`**

In `App.tsx`, update `ProtectedRoute` to show a banner when `agentHealthy` is false. Replace the current return at the end of `ProtectedRoute` (the `return <>{children}</>` line) with:

```typescript
 const [bannerDismissed, setBannerDismissed] = useState(false);

 const showBanner = !bannerDismissed && onboardStatus?.agentHealthy === false;

 return (
   <>
     {showBanner && (
       <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-2 px-4 py-2 text-sm font-medium"
         style={{ background: "rgba(239,68,68,0.15)", borderBottom: "1px solid rgba(239,68,68,0.3)", color: "var(--color-accent-red)" }}>
         <span>Your AI advisor is experiencing issues. Reports may be delayed — please contact support.</span>
         <button onClick={() => setBannerDismissed(true)} className="ml-4 shrink-0 text-base leading-none opacity-70 hover:opacity-100">×</button>
       </div>
     )}
     <div style={showBanner ? { paddingTop: "36px" } : undefined}>
       {children}
     </div>
   </>
 );
```

Also add `useState` to the React import at the top if not already present:
```typescript
import { useState } from "react";
```

- [ ] **Step 2: Commit**

```bash
cd /root/clawd
git add frontend/src/App.tsx
git commit -m "feat: show sticky health banner to users when agent has consecutive model errors"
```

---

### Task 12: Build and deploy

**Files:** none (build artifacts)

- [ ] **Step 1: Full build + deploy**

```bash
cd /root/clawd
./deploy.sh
```

Expected: script completes without errors, ends with `Health check passed`.

- [ ] **Step 2: Verify profiles endpoint**

```bash
curl -s -H "X-Admin-Key: ${ADMIN_KEY}" http://localhost:8081/api/admin/profiles | python3 -m json.tool
```
Expected: `{ "profiles": { "testing": {...}, "production": {...}, "free": {...} } }`

- [ ] **Step 3: Verify user list includes new fields**

```bash
curl -s -H "X-Admin-Key: ${ADMIN_KEY}" http://localhost:8081/api/admin/users | python3 -c "import sys,json; d=json.load(sys.stdin); [print(u['userId'], u.get('modelProfile'), u.get('agentHealth',{}).get('healthy')) for u in d['users']]"
```
Expected: each user line shows `userId modelProfile true/false`

- [ ] **Step 4: Verify profile switch**

```bash
curl -s -X PATCH -H "X-Admin-Key: ${ADMIN_KEY}" -H "Content-Type: application/json" \
  -d '{"profileName":"free"}' \
  http://localhost:8081/api/admin/users/user2/profile | python3 -m json.tool
# Switch back
curl -s -X PATCH -H "X-Admin-Key: ${ADMIN_KEY}" -H "Content-Type: application/json" \
  -d '{"profileName":"testing"}' \
  http://localhost:8081/api/admin/users/user2/profile | python3 -m json.tool
# Confirm config.json was updated
cat /root/clawd/users/user2/data/config.json
```
Expected: `{ "modelProfile": "testing" }` — clean, no embedded profiles block.

- [ ] **Step 5: Verify onboard status includes `agentHealthy`**

Get a JWT first, then:
```bash
TOKEN=$(curl -s -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId":"user2","password":"<PASSWORD>"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8081/api/onboard/status | python3 -m json.tool | grep agentHealthy
```
Expected: `"agentHealthy": false` (since user2 has 13 consecutive errors)

- [ ] **Step 6: Final commit (if any stray changes)**

```bash
cd /root/clawd
git status
# commit anything uncommitted
```

---

## Self-Review

**Spec coverage:**
- ✅ Global `model-profiles.json` — Task 1
- ✅ Zod schemas — Task 2
- ✅ `profileService.ts` — Task 3
- ✅ `getUserAgentHealth()` — Task 4
- ✅ Workspace creates lean config — Task 5
- ✅ Admin profile CRUD routes — Task 6
- ✅ Enrich user list with `modelProfile` + `agentHealth` — Task 6
- ✅ `agentHealthy` in onboard status — Task 7
- ✅ Frontend types — Task 8
- ✅ Frontend admin API — Task 9
- ✅ Admin panel profiles section + badges — Task 10
- ✅ User health banner — Task 11
- ✅ Deploy + verify — Task 12

**Type consistency check:**
- `AgentHealth` defined in Task 4 (`agentService.ts`), exported and consumed in Task 6 admin route, mirrored in Task 8 frontend types, used in Task 9 admin API and Task 10 Admin.tsx — consistent throughout.
- `ProfileDefinition` / `ProfilesRegistry` defined in Task 2, used in Task 3 service, Task 6 routes, Task 9 frontend API, Task 10 Admin.tsx — consistent throughout.
- `getUserProfile` / `setUserProfile` defined in Task 3, imported in Task 6 — names match.
- `getUserAgentHealth` defined in Task 4, imported in Tasks 6 and 7 — names match.

**Security check:**
- All profile routes sit behind `router.use(adminAuth)` — inherited from the existing middleware at line 31 of `admin.ts`.
- `setUserProfile` validates profile exists before writing — no blind writes.
- `deleteProfile` checks no user is on it — referential integrity maintained.
- Profile name regex `/^[a-z0-9-]{2,32}$/` on both Zod schema and service — path traversal impossible.
