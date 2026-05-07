Deploy failed — 2 TypeScript compilation errors in the last 2 commits that weren't caught before merge. I'm stopping
  as instructed.

  ---
  Problem 1 — backend/src/routes/verdictActions.ts:45

  The note field is typed as string | undefined (from Zod's .optional()) but RecordVerdictActionInput.note expects
  string | null. TypeScript's exactOptionalPropertyTypes flag catches this mismatch.

  Proposed Fix: Change note: parsed.data.note → note: parsed.data.note ?? null

  ---
  Problem 2 — backend/src/services/dailyBriefService.ts:11

  getUserPlan is imported but its usage was removed as part of the Phase 7 coverage-limit rewrite (task 7.9 replaced the
   fake pro-plan check with a feature_flags read). The import was never cleaned up.

  Proposed Fix: Remove the getUserPlan import line.
