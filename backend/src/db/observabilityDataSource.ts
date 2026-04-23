import "reflect-metadata";
import { promises as fs } from "fs";
import path from "path";
import { DataSource } from "typeorm";
import { ObservabilityRequestEntitySchema } from "./entities/ObservabilityRequestEntity.js";
import { logger } from "../services/logger.js";

const OBSERVABILITY_DATABASE_URL = process.env["OBSERVABILITY_DATABASE_URL"] ?? "";
const OBSERVABILITY_DDL_PATH =
  process.env["OBSERVABILITY_DDL_PATH"] ??
  path.resolve(process.cwd(), "../db/observability_postgres.sql");

let dataSource: DataSource | null = null;
let ddlApplied = false;

function buildDataSource(): DataSource {
  if (!OBSERVABILITY_DATABASE_URL) {
    throw new Error("OBSERVABILITY_DATABASE_URL is required");
  }

  return new DataSource({
    type: "postgres",
    url: OBSERVABILITY_DATABASE_URL,
    entities: [ObservabilityRequestEntitySchema],
    synchronize: false,
    logging: false,
  });
}

async function applyDdl(ds: DataSource): Promise<void> {
  if (ddlApplied) return;
  const ddl = await fs.readFile(OBSERVABILITY_DDL_PATH, "utf-8");
  await ds.query(ddl);
  ddlApplied = true;
}

export async function getObservabilityDataSource(): Promise<DataSource> {
  if (!dataSource) {
    dataSource = buildDataSource();
  }

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
    await applyDdl(dataSource);
    logger.info("Observability PostgreSQL data source initialized");
  }

  return dataSource;
}

export async function closeObservabilityDataSource(): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
  }
  dataSource = null;
  ddlApplied = false;
}
