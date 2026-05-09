# Pilot feature inventory boundary

## Reader and action

This document is for engineers extending the pilot experience after M001. After reading it, you should be able to add or consume pilot feature inventory entries without mixing immutable catalog data with mutable admin review state.

## Boundary overview

The pilot feature inventory has two sources of truth:

1. **Catalog JSON is immutable product inventory.** It describes what the pilot can see or operate: feature identity, surface, explanation, happy path, edge cases, expected error handling, evidence pointers, and launch recommendation.
2. **Postgres review rows are mutable owner state.** They store status, comments, incorrect-description markers, updater, and update time. Admin review state must not be written back into catalog JSON.

The admin API and UI compose these two sources. Every served feature should include the catalog fields and a `review` object, even when no review row exists yet.

## Catalog entry format

Each catalog file contains an `entries` array. Every entry must include:

- `id`: stable lowercase identifier such as `web.reports-feed` or `telegram.daily-brief-chat`.
- `surface`: one of `web`, `telegram`, `admin`, or `operator`.
- `title`: short human-readable name.
- `shortSummary`: one-sentence inventory summary for browsing.
- `detailedExplanation`: durable explanation of what the feature does in the pilot.
- `happyPath`: one or more normal-use expectations.
- `edgeCases`: one or more boundary or degraded-state expectations.
- `errorHandling`: one or more user-visible or operator-visible failure expectations.
- `evidencePaths`: one or more tracked repository references that justify the inventory entry. Do not point at user workspaces, runtime data, secrets, build outputs, or ignored planning artifacts.
- `pilotRecommendation`: one of `pilot`, `beta`, `defer`, or `hide`.

The catalog loader rejects duplicate IDs, malformed JSON, schema drift, unknown extra fields, missing required arrays, and unsafe evidence pointers.

## Review statuses

Mutable review status lives in Postgres and is returned under `review.status`:

- `unreviewed`: default composed state when no owner review row exists.
- `needs_fix`: description or behavior needs correction before the owner considers it accurate.
- `beta`: visible to pilot users but still being watched closely.
- `hidden`: should not be promoted in pilot-facing review workflows.
- `ready`: owner has reviewed the feature and considers the description accurate for pilot use.

`review.adminComment`, `review.incorrectDescription`, `review.updatedAt`, and `review.updatedBy` travel with the status. PATCH callers may update part of this state, but omitted fields should preserve their existing values.

## `pilotRecommendation` usage

`pilotRecommendation` is immutable catalog guidance, not the owner’s mutable review status:

- `pilot`: expected to be part of the day-one pilot inventory.
- `beta`: useful to expose, but label and monitor it as less mature.
- `defer`: keep documented for continuity, but do not promote as pilot-ready.
- `hide`: keep out of normal pilot-visible inventory unless an owner explicitly needs it for review.

Downstream code should use `pilotRecommendation` to decide default presentation and triage, then use `review.status` for owner-specific overrides and comments.

## S02 guidance: WhatsApp and naming-sensitive entries

M001 treats Web and Telegram as the day-one pilot surfaces. WhatsApp-related behavior may appear inside settings or channel-preference descriptions only as unavailable, blocked, or deferred behavior. Do not promote WhatsApp to a pilot-ready channel in S02 unless a later milestone explicitly changes the channel scope.

Some entries are naming-sensitive because product language distinguishes long-lived **strategies** from per-analysis **reports**. Preserve that distinction when adding descriptions, filters, or UI labels:

- A **report** is an analysis event or generated artifact.
- A **strategy** is the long-lived tracked thesis for an asset.

When adding or editing entries, prefer stable product wording over implementation names. The catalog should remain a user and owner review contract, not a source-code map.

## Change checklist

Before changing the inventory boundary:

1. Add or edit catalog entries with all immutable fields present.
2. Keep evidence pointers limited to tracked, non-sensitive repository files.
3. Do not store admin status, comments, or incorrect-description flags in JSON.
4. Ensure API responses still compose every catalog item with a complete `review` object.
5. Run the backend pilot feature tests, the backend suite, and the frontend build.
