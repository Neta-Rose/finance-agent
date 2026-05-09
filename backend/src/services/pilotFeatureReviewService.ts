import { getApplicationDataSource, isApplicationDatabaseConfigured } from "../db/applicationDataSource.js";
import type { PilotFeatureReviewEntity } from "../db/entities/PilotFeatureReviewEntity.js";
import {
  PilotFeatureReviewStatusSchema,
  type PilotFeatureCatalogEntry,
  type PilotFeatureReviewStatus,
} from "../schemas/pilotFeature.js";
import {
  PilotFeatureCatalogError,
  loadPilotFeatureCatalog,
} from "./pilotFeatureCatalogService.js";
import { logger } from "./logger.js";

const MAX_ADMIN_COMMENT_LENGTH = 2_000;
const MAX_UPDATED_BY_LENGTH = 128;

export type PilotFeatureReviewServiceErrorCode =
  | "DATABASE_UNAVAILABLE"
  | "CATALOG_LOAD_FAILED"
  | "INVALID_REVIEW_INPUT"
  | "UNKNOWN_FEATURE_ID";

export class PilotFeatureReviewServiceError extends Error {
  constructor(
    public readonly code: PilotFeatureReviewServiceErrorCode,
    message: string,
    public readonly details: Record<string, string> = {}
  ) {
    super(message);
    this.name = "PilotFeatureReviewServiceError";
  }
}

export interface PilotFeatureReviewState {
  status: PilotFeatureReviewStatus;
  adminComment: string | null;
  incorrectDescription: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface PilotFeatureWithReview extends PilotFeatureCatalogEntry {
  review: PilotFeatureReviewState;
}

export interface UpsertPilotFeatureReviewInput {
  featureId: string;
  status: PilotFeatureReviewStatus | string;
  adminComment?: string | null;
  incorrectDescription?: boolean;
  updatedBy: string;
}

interface PilotFeatureReviewDataSource {
  query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T>;
}

interface PilotFeatureReviewRow {
  feature_id: string;
  status: PilotFeatureReviewStatus;
  admin_comment: string | null;
  incorrect_description: boolean;
  updated_at: Date | string;
  updated_by: string;
}

interface PilotFeatureReviewServiceDeps {
  catalogLoader?: () => Promise<PilotFeatureCatalogEntry[]>;
  databaseConfigured?: () => boolean;
  dataSourceProvider?: () => Promise<PilotFeatureReviewDataSource>;
}

const SELECT_COLUMNS =
  "feature_id, status, admin_comment, incorrect_description, updated_at, updated_by";

function defaultReview(): PilotFeatureReviewState {
  return {
    status: "unreviewed",
    adminComment: null,
    incorrectDescription: false,
    updatedAt: null,
    updatedBy: null,
  };
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function fromRow(row: PilotFeatureReviewRow): PilotFeatureReviewState {
  return {
    status: row.status,
    adminComment: row.admin_comment,
    incorrectDescription: row.incorrect_description,
    updatedAt: toIso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function toEntity(row: PilotFeatureReviewRow): PilotFeatureReviewEntity {
  return {
    featureId: row.feature_id,
    status: row.status,
    adminComment: row.admin_comment,
    incorrectDescription: row.incorrect_description,
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function serviceDeps(deps: PilotFeatureReviewServiceDeps): Required<PilotFeatureReviewServiceDeps> {
  return {
    catalogLoader: deps.catalogLoader ?? loadPilotFeatureCatalog,
    databaseConfigured: deps.databaseConfigured ?? isApplicationDatabaseConfigured,
    dataSourceProvider: deps.dataSourceProvider ?? getApplicationDataSource,
  };
}

async function loadCatalogForReview(
  catalogLoader: () => Promise<PilotFeatureCatalogEntry[]>
): Promise<PilotFeatureCatalogEntry[]> {
  try {
    return await catalogLoader();
  } catch (error) {
    const reason = error instanceof PilotFeatureCatalogError ? error.message : "catalog load failed";
    logger.warn(`pilot_feature_review_catalog_failed reason=${reason}`);
    throw new PilotFeatureReviewServiceError(
      "CATALOG_LOAD_FAILED",
      "Pilot feature catalog could not be loaded",
      { reason }
    );
  }
}

async function getReviewDataSource(
  deps: Required<PilotFeatureReviewServiceDeps>,
  featureId?: string
): Promise<PilotFeatureReviewDataSource> {
  if (!deps.databaseConfigured()) {
    throw new PilotFeatureReviewServiceError(
      "DATABASE_UNAVAILABLE",
      "Pilot feature review storage is not configured"
    );
  }

  try {
    return await deps.dataSourceProvider();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`pilot_feature_review_db_unavailable feature_id=${featureId ?? "<list>"} reason=${reason}`);
    throw new PilotFeatureReviewServiceError(
      "DATABASE_UNAVAILABLE",
      "Pilot feature review storage is unavailable",
      { reason }
    );
  }
}

function validateReviewInput(input: UpsertPilotFeatureReviewInput): {
  featureId: string;
  status: PilotFeatureReviewStatus;
  adminComment: string | null;
  incorrectDescription: boolean;
  updatedBy: string;
} {
  const featureId = input.featureId.trim();
  if (!featureId) {
    throw new PilotFeatureReviewServiceError("INVALID_REVIEW_INPUT", "featureId is required", {
      field: "featureId",
    });
  }

  const parsedStatus = PilotFeatureReviewStatusSchema.safeParse(input.status);
  if (!parsedStatus.success) {
    throw new PilotFeatureReviewServiceError("INVALID_REVIEW_INPUT", "Invalid pilot feature review status", {
      field: "status",
    });
  }

  const adminComment = input.adminComment === undefined ? null : input.adminComment;
  if (adminComment !== null) {
    if (typeof adminComment !== "string") {
      throw new PilotFeatureReviewServiceError("INVALID_REVIEW_INPUT", "adminComment must be a string or null", {
        field: "adminComment",
      });
    }
    if (adminComment.length > MAX_ADMIN_COMMENT_LENGTH) {
      throw new PilotFeatureReviewServiceError("INVALID_REVIEW_INPUT", "adminComment is too long", {
        field: "adminComment",
        maxLength: String(MAX_ADMIN_COMMENT_LENGTH),
      });
    }
  }

  const updatedBy = input.updatedBy.trim();
  if (!updatedBy || updatedBy.length > MAX_UPDATED_BY_LENGTH) {
    throw new PilotFeatureReviewServiceError("INVALID_REVIEW_INPUT", "updatedBy is required and must be bounded", {
      field: "updatedBy",
      maxLength: String(MAX_UPDATED_BY_LENGTH),
    });
  }

  return {
    featureId,
    status: parsedStatus.data,
    adminComment,
    incorrectDescription: input.incorrectDescription ?? false,
    updatedBy,
  };
}

function findKnownCatalogEntry(
  catalog: PilotFeatureCatalogEntry[],
  featureId: string
): PilotFeatureCatalogEntry {
  const entry = catalog.find((candidate) => candidate.id === featureId);
  if (!entry) {
    throw new PilotFeatureReviewServiceError("UNKNOWN_FEATURE_ID", "Pilot feature id is not in the catalog", {
      featureId,
    });
  }
  return entry;
}

export async function listPilotFeaturesWithReviews(
  deps: PilotFeatureReviewServiceDeps = {}
): Promise<PilotFeatureWithReview[]> {
  const resolvedDeps = serviceDeps(deps);
  const catalog = await loadCatalogForReview(resolvedDeps.catalogLoader);
  const featureIds = catalog.map((entry) => entry.id);
  const ds = await getReviewDataSource(resolvedDeps);

  let rows: PilotFeatureReviewRow[];
  try {
    rows = await ds.query(
      `SELECT ${SELECT_COLUMNS}
         FROM pilot_feature_reviews
        WHERE feature_id = ANY($1::text[])`,
      [featureIds]
    ) as PilotFeatureReviewRow[];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`pilot_feature_review_list_failed reason=${reason}`);
    throw new PilotFeatureReviewServiceError(
      "DATABASE_UNAVAILABLE",
      "Pilot feature review storage is unavailable",
      { reason }
    );
  }

  const reviewsByFeatureId = new Map(rows.map((row) => [row.feature_id, fromRow(row)]));
  return catalog.map((entry) => ({
    ...entry,
    review: reviewsByFeatureId.get(entry.id) ?? defaultReview(),
  }));
}

export async function upsertPilotFeatureReview(
  input: UpsertPilotFeatureReviewInput,
  deps: PilotFeatureReviewServiceDeps = {}
): Promise<PilotFeatureWithReview> {
  const validated = validateReviewInput(input);
  const resolvedDeps = serviceDeps(deps);
  const catalog = await loadCatalogForReview(resolvedDeps.catalogLoader);
  const entry = findKnownCatalogEntry(catalog, validated.featureId);
  const ds = await getReviewDataSource(resolvedDeps, validated.featureId);

  let rows: PilotFeatureReviewRow[];
  try {
    rows = await ds.query(
      `INSERT INTO pilot_feature_reviews
         (feature_id, status, admin_comment, incorrect_description, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (feature_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         admin_comment = EXCLUDED.admin_comment,
         incorrect_description = EXCLUDED.incorrect_description,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by
       RETURNING ${SELECT_COLUMNS}`,
      [
        validated.featureId,
        validated.status,
        validated.adminComment,
        validated.incorrectDescription,
        validated.updatedBy,
      ]
    ) as PilotFeatureReviewRow[];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`pilot_feature_review_upsert_failed feature_id=${validated.featureId} reason=${reason}`);
    throw new PilotFeatureReviewServiceError(
      "DATABASE_UNAVAILABLE",
      "Pilot feature review storage is unavailable",
      { reason, featureId: validated.featureId }
    );
  }

  return {
    ...entry,
    review: fromRow(rows[0]!),
  };
}

export const pilotFeatureReviewServiceInternals = {
  MAX_ADMIN_COMMENT_LENGTH,
  toEntity,
};
