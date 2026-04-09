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
