import { z } from "zod";

export const PilotFeatureSurfaceSchema = z.enum(["admin", "operator", "telegram", "web"]);

export const PilotFeatureReviewStatusSchema = z.enum([
  "unreviewed",
  "needs_fix",
  "beta",
  "hidden",
  "ready",
]);

export const PilotFeatureRecommendationSchema = z.enum([
  "pilot",
  "beta",
  "defer",
  "hide",
]);

const NonEmptyStringArraySchema = z.array(z.string().trim().min(1)).min(1);

export const PilotFeatureCatalogEntrySchema = z.object({
  id: z.string().trim().min(1).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  surface: PilotFeatureSurfaceSchema,
  title: z.string().trim().min(1),
  shortSummary: z.string().trim().min(1),
  detailedExplanation: z.string().trim().min(1),
  happyPath: NonEmptyStringArraySchema,
  edgeCases: NonEmptyStringArraySchema,
  errorHandling: NonEmptyStringArraySchema,
  evidencePaths: NonEmptyStringArraySchema,
  pilotRecommendation: PilotFeatureRecommendationSchema,
}).strict();

export const PilotFeatureCatalogFileSchema = z.object({
  entries: z.array(PilotFeatureCatalogEntrySchema).min(1),
}).strict();

export type PilotFeatureSurface = z.infer<typeof PilotFeatureSurfaceSchema>;
export type PilotFeatureReviewStatus = z.infer<typeof PilotFeatureReviewStatusSchema>;
export type PilotFeatureRecommendation = z.infer<typeof PilotFeatureRecommendationSchema>;
export type PilotFeatureCatalogEntry = z.infer<typeof PilotFeatureCatalogEntrySchema>;
export type PilotFeatureCatalogFile = z.infer<typeof PilotFeatureCatalogFileSchema>;
