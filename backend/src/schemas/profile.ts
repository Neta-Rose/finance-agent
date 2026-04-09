/**
 * Schemas for the global model profile registry and per-user config.
 *
 * Design split:
 *   - Global registry (`data/model-profiles.json`): defines available profiles
 *     (orchestrator/analysts/risk/researchers model IDs). Single source of truth.
 *   - Per-user config (`users/[id]/data/config.json`): stores only the active
 *     profile name as `{ modelProfile: "testing" }`. No embedded definitions.
 *
 * Note: `UserConfigSchema` uses `.passthrough()` so that legacy config.json files
 * containing an embedded `profiles` block are not silently stripped during a
 * read-then-write. Once Task 5 (workspaceService strip) is deployed, all new
 * config files will be lean and passthrough is a no-op safety net.
 */
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

export const UserConfigSchema = z
  .object({ modelProfile: z.string().min(1) })
  .passthrough();

export type ProfileDefinition = z.infer<typeof ProfileDefinitionSchema>;
export type ProfilesRegistry = z.infer<typeof ProfilesRegistrySchema>;
export type UserConfig = z.infer<typeof UserConfigSchema>;
