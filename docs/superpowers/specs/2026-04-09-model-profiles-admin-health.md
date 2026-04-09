# Model Profiles & Agent Health — Design Spec
**Date:** 2026-04-09  
**Status:** Approved

---

## Problem

1. Model profile definitions are duplicated per-user inside `config.json`. Changing a profile (e.g. upgrading "testing" models) requires touching every user file. There is no single source of truth.
2. When agent model auth fails repeatedly (e.g. expired API key, out of credits), the failure is silent. The job stays frozen at `status: "running"`. Neither the admin nor the user sees anything wrong.
3. The admin panel has no way to view or change a user's active model profile.

---

## Design

### 1. Global Profile Registry

**File:** `~/clawd/data/model-profiles.json`

Single source of truth for all profile definitions. Admin creates/edits/deletes profiles here. All users reference a profile by name only.

```json
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
```

**OCP compliance:** adding a new profile = add a key to this file. Zero backend code changes needed.

### 2. Per-User Config Shape (simplified)

`users/[userId]/data/config.json` stores only the active profile name:

```json
{ "modelProfile": "testing" }
```

The embedded `profiles` block is removed from new user creation. Existing users retain their embedded block but it is **ignored at runtime** — the backend always reads from the global registry. Embedded profiles are silently stripped the next time a profile switch occurs.

**Default profile for new users:** `"testing"`

### 3. Zod Schema — `backend/src/schemas/profile.ts` (new file)

```typescript
export const ProfileDefinitionSchema = z.object({
  orchestrator: z.string().min(1),
  analysts: z.string().min(1),
  risk: z.string().min(1),
  researchers: z.string().min(1),
});
export const ProfilesRegistrySchema = z.record(
  z.string().regex(/^[a-z0-9-]{2,32}$/),
  ProfileDefinitionSchema
);
export type ProfileDefinition = z.infer<typeof ProfileDefinitionSchema>;
export type ProfilesRegistry = z.infer<typeof ProfilesRegistrySchema>;
```

### 4. `profileService.ts` (new service)

Owns all registry I/O. No other service touches `model-profiles.json` directly.

```
listProfiles()                              → ProfilesRegistry
getProfile(name)                            → ProfileDefinition | null
createProfile(name, def)                    → void (throws if name exists)
updateProfile(name, def)                    → void (throws if not found)
deleteProfile(name, allUserConfigs)         → void (throws if any user is on this profile)
getUserProfile(userId)                      → string  (reads config.json → modelProfile)
setUserProfile(userId, profileName)         → void    (validates profile exists, writes config.json, strips embedded profiles block)
```

`DATA_DIR` is read from `process.env.DATA_DIR ?? "../data"` (consistent with existing env var usage).

### 5. Agent Health — `agentService.ts` additions

Reads `~/.openclaw/cron/jobs.json` to extract health per user:

```typescript
export interface AgentHealth {
  healthy: boolean;
  consecutiveErrors: number;
  lastError: string | null;
  lastRunAt: string | null;
}
export async function getUserAgentHealth(userId: string): Promise<AgentHealth>
```

**Threshold:** `consecutiveErrors >= 10` → `healthy: false`.

### 6. Backend API Changes

#### New admin profile routes (added to `admin.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/profiles` | List all profiles |
| POST | `/api/admin/profiles` | Create a new profile |
| PATCH | `/api/admin/profiles/:name` | Update a profile's model assignments |
| DELETE | `/api/admin/profiles/:name` | Delete a profile (fails if any user is on it) |
| PATCH | `/api/admin/users/:userId/profile` | Switch a user's active profile |

#### Enhanced `GET /api/admin/users`

Each user entry gains:
```typescript
modelProfile: string;        // from config.json
agentHealth: AgentHealth;    // from cron jobs.json
```

#### Enhanced `GET /api/onboard/status`

Gains:
```typescript
agentHealthy: boolean;  // false when consecutiveErrors >= 10
```

#### `workspaceService.ts`

`createUserWorkspace` writes config.json as `{ modelProfile: "testing" }` — no embedded `profiles` block.

### 7. Frontend Changes

#### Admin page — new "Model Profiles" section

Located above the user list. Shows a card per profile with:
- Profile name + badge (name)
- Model assignments (orchestrator, analysts, risk, researchers)
- Edit button → inline form
- Delete button → disabled if any user is on this profile, with tooltip "X users on this profile"
- "+ Add Profile" button → modal with name + 4 model fields

#### Admin page — per-user card additions

- **Profile badge**: coloured pill showing active profile name (e.g. blue=testing, green=production, grey=free). Click → dropdown to switch.
- **Health badge**: green "OK" or red "Error" with a hover tooltip showing `lastError` truncated to 120 chars.

#### User dashboard — health banner

In `App.tsx` (wrapping ProtectedRoutes), after fetching `/api/onboard/status`:

```
if (!agentHealthy) → render sticky top banner:
  "Your AI advisor is experiencing issues. Reports may be delayed. Please contact support."
  (dismissible per session, orange/amber styling using --color-accent-red at 80% opacity)
```

### 8. Data Migration

No forced migration. Existing users' config.json retains embedded `profiles` — these are ignored at runtime. On next profile switch by admin, `setUserProfile` writes a clean `{ modelProfile: "..." }` stripping the embedded block. No migration script needed.

### 9. Security

- All profile admin routes protected by `adminAuth` middleware (X-Admin-Key), same as existing admin routes.
- `profileService` validates profile names against `/^[a-z0-9-]{2,32}$/` — prevents path traversal in the registry key.
- `setUserProfile` validates the target profile exists in the registry before writing user config — prevents assigning a nonexistent profile.
- `deleteProfile` reads all user configs to verify no user is on the profile before deleting — referential integrity without a DB.
- Agent health reads from a read-only cron state file — no writes.

---

## Files Touched

| File | Change |
|------|--------|
| `data/model-profiles.json` | **New** — global registry |
| `backend/src/schemas/profile.ts` | **New** — Zod schemas |
| `backend/src/services/profileService.ts` | **New** — registry + user config I/O |
| `backend/src/services/agentService.ts` | **Add** `getUserAgentHealth()` |
| `backend/src/services/workspaceService.ts` | **Edit** — strip embedded profiles from `createUserWorkspace` |
| `backend/src/routes/admin.ts` | **Edit** — add profile routes, enrich user list response |
| `backend/src/routes/onboarding.ts` | **Edit** — add `agentHealthy` to status response |
| `frontend/src/api/admin.ts` | **Edit** — add profile API calls |
| `frontend/src/pages/Admin.tsx` | **Edit** — profile management section + per-user profile/health |
| `frontend/src/App.tsx` or layout | **Edit** — agent health banner for regular users |

---

## Non-Goals

- No UI for users to see or select profiles (admin-only).
- No automatic job retry / stuck-job timeout (future work).
- No database — file-based registry consistent with platform architecture.
