import test from "node:test";
import assert from "node:assert/strict";
import type { PilotFeatureWithReview } from "../services/pilotFeatureReviewService.js";
import { PilotFeatureReviewServiceError } from "../services/pilotFeatureReviewService.js";

process.env["ADMIN_KEY"] = "test-admin-key";
process.env["APP_DATABASE_URL"] = "postgres://admin-pilot-feature-test";

const baseFeature = {
  id: "web.dashboard",
  surface: "web" as const,
  title: "Web dashboard",
  shortSummary: "Browse portfolio health.",
  detailedExplanation: "Shows current portfolio health to the pilot user.",
  happyPath: ["Open dashboard"],
  edgeCases: ["Empty portfolio"],
  errorHandling: ["Show a recoverable empty state"],
  evidencePaths: ["backend/src/routes/admin.ts"],
  pilotRecommendation: "pilot" as const,
};

function feature(
  id: string,
  surface: PilotFeatureWithReview["surface"],
  status: PilotFeatureWithReview["review"]["status"],
  title = id
): PilotFeatureWithReview {
  return {
    ...baseFeature,
    id,
    surface,
    title,
    review: {
      status,
      adminComment: null,
      incorrectDescription: false,
      updatedAt: null,
      updatedBy: null,
    },
  };
}

function assertPilotFeatureApiContract(item: PilotFeatureWithReview): void {
  assert.equal(typeof item.id, "string");
  assert.ok(["admin", "operator", "telegram", "web"].includes(item.surface));
  assert.equal(typeof item.title, "string");
  assert.equal(typeof item.shortSummary, "string");
  assert.equal(typeof item.detailedExplanation, "string");
  assert.ok(Array.isArray(item.happyPath) && item.happyPath.length > 0);
  assert.ok(Array.isArray(item.edgeCases) && item.edgeCases.length > 0);
  assert.ok(Array.isArray(item.errorHandling) && item.errorHandling.length > 0);
  assert.ok(Array.isArray(item.evidencePaths) && item.evidencePaths.length > 0);
  assert.ok(["pilot", "beta", "defer", "hide"].includes(item.pilotRecommendation));
  assert.ok(["unreviewed", "needs_fix", "beta", "hidden", "ready"].includes(item.review.status));
  assert.ok(typeof item.review.incorrectDescription === "boolean");
  assert.ok(item.review.adminComment === null || typeof item.review.adminComment === "string");
  assert.ok(item.review.updatedAt === null || typeof item.review.updatedAt === "string");
  assert.ok(item.review.updatedBy === null || typeof item.review.updatedBy === "string");
}

async function invokeAdminRouterJson(options: {
  method: "GET" | "PATCH";
  url: string;
  query?: Record<string, unknown>;
  body?: unknown;
  adminKey?: string;
}): Promise<{ statusCode: number; body: unknown }> {
  const adminModule = await import("./admin.js");
  const adminRouter = adminModule.default as unknown as {
    handle: (req: object, res: object, next: (error?: unknown) => void) => void;
  };

  return await new Promise((resolve, reject) => {
    const req = {
      method: options.method,
      url: options.url,
      originalUrl: options.url,
      headers: { "x-admin-key": options.adminKey ?? "test-admin-key" },
      query: options.query ?? {},
      body: options.body,
    };
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        resolve({ statusCode: this.statusCode, body });
        return this;
      },
    };

    adminRouter.handle(req, res, (error?: unknown) => {
      if (error) reject(error);
      else reject(new Error(`Route fell through without response for ${options.method} ${options.url}`));
    });
  });
}

test("admin pilot features GET /pilot-features composes review state, filters, and paginates", async () => {
  const { setPilotFeatureAdminRouteDepsForTest } = await import("./admin.js");
  setPilotFeatureAdminRouteDepsForTest({
    databaseConfigured: () => true,
    listPilotFeaturesWithReviews: async () => [
      feature("web.dashboard", "web", "ready", "Dashboard"),
      feature("telegram.alerts", "telegram", "ready", "Telegram alerts"),
      feature("web.chat", "web", "ready", "Chat"),
      feature("web.settings", "web", "hidden", "Settings"),
    ],
    upsertPilotFeatureReview: async () => feature("unused", "web", "ready"),
  });

  const result = await invokeAdminRouterJson({
    method: "GET",
    url: "/pilot-features",
    query: { surface: "web", status: "ready", limit: "1", offset: "1" },
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    items: [feature("web.chat", "web", "ready", "Chat")],
    total: 2,
    limit: 1,
    offset: 1,
    databaseAvailable: true,
  });
  const items = (result.body as { items: PilotFeatureWithReview[] }).items;
  assert.equal(items.length, 1);
  for (const item of items) {
    assertPilotFeatureApiContract(item);
  }
});

test("admin pilot features PATCH /pilot-features/:featureId/review updates state and subsequent list reads it", async () => {
  const { setPilotFeatureAdminRouteDepsForTest } = await import("./admin.js");
  const store = new Map<string, PilotFeatureWithReview>([
    ["web.dashboard", feature("web.dashboard", "web", "unreviewed", "Dashboard")],
  ]);
  setPilotFeatureAdminRouteDepsForTest({
    databaseConfigured: () => true,
    listPilotFeaturesWithReviews: async () => Array.from(store.values()),
    upsertPilotFeatureReview: async (input) => {
      const current = store.get(input.featureId);
      if (!current) {
        throw new PilotFeatureReviewServiceError("UNKNOWN_FEATURE_ID", "unknown", { featureId: input.featureId });
      }
      const updated: PilotFeatureWithReview = {
        ...current,
        review: {
          status: input.status as PilotFeatureWithReview["review"]["status"],
          adminComment: input.adminComment ?? null,
          incorrectDescription: input.incorrectDescription ?? false,
          updatedAt: "2026-05-09T00:00:00.000Z",
          updatedBy: input.updatedBy,
        },
      };
      store.set(input.featureId, updated);
      return updated;
    },
  });

  const patch = await invokeAdminRouterJson({
    method: "PATCH",
    url: "/pilot-features/web.dashboard/review",
    body: {
      status: "needs_fix",
      adminComment: "Description omits the empty portfolio case.",
      incorrectDescription: true,
      updatedBy: "route-test",
    },
  });

  assert.equal(patch.statusCode, 200);
  const patchedFeature = (patch.body as { feature: PilotFeatureWithReview }).feature;
  assertPilotFeatureApiContract(patchedFeature);
  assert.equal(patchedFeature.review.status, "needs_fix");

  const list = await invokeAdminRouterJson({ method: "GET", url: "/pilot-features" });
  const listed = (list.body as { items: PilotFeatureWithReview[] }).items[0];
  assert.equal(listed?.review.status, "needs_fix");
  assert.equal(listed?.review.adminComment, "Description omits the empty portfolio case.");
  assert.equal(listed?.review.incorrectDescription, true);
  assert.equal(listed?.review.updatedBy, "route-test");
});

test("admin pilot features PATCH /pilot-features/:featureId/review preserves omitted review fields", async () => {
  const { setPilotFeatureAdminRouteDepsForTest } = await import("./admin.js");
  const existing = feature("web.dashboard", "web", "beta", "Dashboard");
  existing.review.adminComment = "Keep this comment.";
  existing.review.incorrectDescription = true;
  setPilotFeatureAdminRouteDepsForTest({
    databaseConfigured: () => true,
    listPilotFeaturesWithReviews: async () => [existing],
    upsertPilotFeatureReview: async (input) => ({
      ...existing,
      review: {
        status: input.status as PilotFeatureWithReview["review"]["status"],
        adminComment: input.adminComment ?? null,
        incorrectDescription: input.incorrectDescription ?? false,
        updatedAt: "2026-05-09T00:00:00.000Z",
        updatedBy: input.updatedBy,
      },
    }),
  });

  const result = await invokeAdminRouterJson({
    method: "PATCH",
    url: "/pilot-features/web.dashboard/review",
    body: { status: "ready", updatedBy: "route-test" },
  });

  assert.equal(result.statusCode, 200);
  const updated = (result.body as { feature: PilotFeatureWithReview }).feature;
  assert.equal(updated.review.status, "ready");
  assert.equal(updated.review.adminComment, "Keep this comment.");
  assert.equal(updated.review.incorrectDescription, true);
});

test("admin pilot features GET /pilot-features rejects invalid filters", async () => {
  const { setPilotFeatureAdminRouteDepsForTest } = await import("./admin.js");
  setPilotFeatureAdminRouteDepsForTest({
    databaseConfigured: () => true,
    listPilotFeaturesWithReviews: async () => [feature("web.dashboard", "web", "ready")],
    upsertPilotFeatureReview: async () => feature("unused", "web", "ready"),
  });

  const result = await invokeAdminRouterJson({
    method: "GET",
    url: "/pilot-features",
    query: { status: "published" },
  });

  assert.equal(result.statusCode, 400);
  assert.equal((result.body as { error?: string }).error, "invalid_pilot_feature_filter");
});

test("admin pilot features PATCH /pilot-features/:featureId/review rejects invalid status and comment", async () => {
  const { setPilotFeatureAdminRouteDepsForTest } = await import("./admin.js");
  setPilotFeatureAdminRouteDepsForTest({
    databaseConfigured: () => true,
    listPilotFeaturesWithReviews: async () => [feature("web.dashboard", "web", "ready")],
    upsertPilotFeatureReview: async () => feature("unused", "web", "ready"),
  });

  const invalidStatus = await invokeAdminRouterJson({
    method: "PATCH",
    url: "/pilot-features/web.dashboard/review",
    body: { status: "published", updatedBy: "route-test" },
  });
  assert.equal(invalidStatus.statusCode, 422);
  assert.equal((invalidStatus.body as { error?: string }).error, "invalid_pilot_feature_review");

  const invalidComment = await invokeAdminRouterJson({
    method: "PATCH",
    url: "/pilot-features/web.dashboard/review",
    body: { adminComment: "x".repeat(2_001), updatedBy: "route-test" },
  });
  assert.equal(invalidComment.statusCode, 422);
  assert.equal((invalidComment.body as { error?: string }).error, "invalid_pilot_feature_review");
});

test("admin pilot features PATCH /pilot-features/:featureId/review returns 404 and does not write unknown feature ids", async () => {
  const { setPilotFeatureAdminRouteDepsForTest } = await import("./admin.js");
  let wrote = false;
  setPilotFeatureAdminRouteDepsForTest({
    databaseConfigured: () => true,
    listPilotFeaturesWithReviews: async () => [feature("web.dashboard", "web", "ready")],
    upsertPilotFeatureReview: async () => {
      wrote = true;
      return feature("unknown", "web", "ready");
    },
  });

  const result = await invokeAdminRouterJson({
    method: "PATCH",
    url: "/pilot-features/not-in-catalog/review",
    body: { status: "ready", updatedBy: "route-test" },
  });

  assert.equal(result.statusCode, 404);
  assert.equal((result.body as { error?: string }).error, "pilot_feature_not_found");
  assert.equal(wrote, false);
});

test("admin pilot features GET /pilot-features returns 503 instead of partial catalog when database is unavailable", async () => {
  const { setPilotFeatureAdminRouteDepsForTest } = await import("./admin.js");
  setPilotFeatureAdminRouteDepsForTest({
    databaseConfigured: () => false,
    listPilotFeaturesWithReviews: async () => {
      throw new PilotFeatureReviewServiceError("DATABASE_UNAVAILABLE", "db unavailable");
    },
    upsertPilotFeatureReview: async () => feature("unused", "web", "ready"),
  });

  const result = await invokeAdminRouterJson({ method: "GET", url: "/pilot-features" });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, {
    error: "application_database_unavailable",
    databaseAvailable: false,
  });
});
