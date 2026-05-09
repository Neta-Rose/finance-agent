import test from "node:test";
import assert from "node:assert/strict";

import type { PilotFeatureCatalogEntry } from "../schemas/pilotFeature.js";
import {
  PilotFeatureReviewServiceError,
  listPilotFeaturesWithReviews,
  upsertPilotFeatureReview,
  pilotFeatureReviewServiceInternals,
} from "./pilotFeatureReviewService.js";

const catalog: PilotFeatureCatalogEntry[] = [
  {
    id: "web.portfolio",
    surface: "web",
    title: "Portfolio overview",
    shortSummary: "Shows portfolio status.",
    detailedExplanation: "Shows portfolio holdings, health, and active analysis status for the pilot.",
    happyPath: ["User opens portfolio"],
    edgeCases: ["Empty portfolio renders an empty state"],
    errorHandling: ["API failure renders retryable error state"],
    evidencePaths: ["frontend/src/pages/Portfolio.tsx"],
    pilotRecommendation: "pilot",
  },
  {
    id: "telegram.daily-brief",
    surface: "telegram",
    title: "Daily brief delivery",
    shortSummary: "Sends daily summaries.",
    detailedExplanation: "Sends pilot daily brief summaries through the Telegram channel.",
    happyPath: ["Scheduler triggers daily brief"],
    edgeCases: ["Telegram chat is not linked"],
    errorHandling: ["Delivery failure is logged and retried by job lifecycle"],
    evidencePaths: ["backend/src/routes/telegram.ts"],
    pilotRecommendation: "pilot",
  },
];

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makeDataSource(rowsByCall: unknown[][] = []) {
  const calls: QueryCall[] = [];
  return {
    calls,
    ds: {
      async query<T = unknown>(sql: string, params: unknown[]): Promise<T> {
        calls.push({ sql, params });
        return (rowsByCall.shift() ?? []) as T;
      },
    },
  };
}

function configuredDeps(ds: { query<T = unknown>(sql: string, params: unknown[]): Promise<T> }) {
  return {
    catalogLoader: async () => catalog,
    databaseConfigured: () => true,
    dataSourceProvider: async () => ds,
  };
}

test("pilot feature review service composes catalog entries with default and persisted review state", async () => {
  const { ds, calls } = makeDataSource([
    [
      {
        feature_id: "telegram.daily-brief",
        status: "beta",
        admin_comment: "Watch first pilot cohort before marking ready.",
        incorrect_description: false,
        updated_at: new Date("2026-01-02T03:04:05.000Z"),
        updated_by: "owner",
      },
    ],
  ]);

  const result = await listPilotFeaturesWithReviews(configuredDeps(ds));

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /WHERE feature_id = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(calls[0]!.params, [["web.portfolio", "telegram.daily-brief"]]);
  assert.equal(result[0]!.review.status, "unreviewed");
  assert.equal(result[0]!.review.updatedAt, null);
  assert.equal(result[1]!.review.status, "beta");
  assert.equal(result[1]!.review.adminComment, "Watch first pilot cohort before marking ready.");
  assert.equal(result[1]!.review.updatedAt, "2026-01-02T03:04:05.000Z");
});

test("pilot feature review service upserts a known feature review", async () => {
  const updatedAt = new Date("2026-02-03T04:05:06.000Z");
  const { ds, calls } = makeDataSource([
    [
      {
        feature_id: "web.portfolio",
        status: "ready",
        admin_comment: "Good enough for pilot.",
        incorrect_description: true,
        updated_at: updatedAt,
        updated_by: "owner",
      },
    ],
  ]);

  const result = await upsertPilotFeatureReview(
    {
      featureId: " web.portfolio ",
      status: "ready",
      adminComment: "Good enough for pilot.",
      incorrectDescription: true,
      updatedBy: " owner ",
    },
    configuredDeps(ds)
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /ON CONFLICT \(feature_id\)/);
  assert.deepEqual(calls[0]!.params, [
    "web.portfolio",
    "ready",
    "Good enough for pilot.",
    true,
    "owner",
  ]);
  assert.equal(result.id, "web.portfolio");
  assert.deepEqual(result.review, {
    status: "ready",
    adminComment: "Good enough for pilot.",
    incorrectDescription: true,
    updatedAt: "2026-02-03T04:05:06.000Z",
    updatedBy: "owner",
  });
});

test("pilot feature review service rejects invalid status and oversized comments before writing", async () => {
  const { ds, calls } = makeDataSource();

  await assert.rejects(
    () => upsertPilotFeatureReview(
      {
        featureId: "web.portfolio",
        status: "launched",
        updatedBy: "owner",
      },
      configuredDeps(ds)
    ),
    (error: unknown) => error instanceof PilotFeatureReviewServiceError && error.code === "INVALID_REVIEW_INPUT"
  );

  await assert.rejects(
    () => upsertPilotFeatureReview(
      {
        featureId: "web.portfolio",
        status: "ready",
        adminComment: "x".repeat(pilotFeatureReviewServiceInternals.MAX_ADMIN_COMMENT_LENGTH + 1),
        updatedBy: "owner",
      },
      configuredDeps(ds)
    ),
    (error: unknown) => error instanceof PilotFeatureReviewServiceError && error.code === "INVALID_REVIEW_INPUT"
  );

  assert.equal(calls.length, 0);
});

test("pilot feature review service refuses unknown catalog ids before writing", async () => {
  const { ds, calls } = makeDataSource();

  await assert.rejects(
    () => upsertPilotFeatureReview(
      {
        featureId: "web.missing",
        status: "ready",
        updatedBy: "owner",
      },
      configuredDeps(ds)
    ),
    (error: unknown) => error instanceof PilotFeatureReviewServiceError && error.code === "UNKNOWN_FEATURE_ID"
  );

  assert.equal(calls.length, 0);
});

test("pilot feature review service exposes unavailable database and catalog load failures as typed errors", async () => {
  const { ds, calls } = makeDataSource();

  await assert.rejects(
    () => listPilotFeaturesWithReviews({
      catalogLoader: async () => catalog,
      databaseConfigured: () => false,
      dataSourceProvider: async () => ds,
    }),
    (error: unknown) => error instanceof PilotFeatureReviewServiceError && error.code === "DATABASE_UNAVAILABLE"
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    () => listPilotFeaturesWithReviews({
      catalogLoader: async () => { throw new Error("boom"); },
      databaseConfigured: () => true,
      dataSourceProvider: async () => ds,
    }),
    (error: unknown) => error instanceof PilotFeatureReviewServiceError && error.code === "CATALOG_LOAD_FAILED"
  );
});
