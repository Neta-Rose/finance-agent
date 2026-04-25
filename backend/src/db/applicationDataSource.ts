import "reflect-metadata";
import { promises as fs } from "fs";
import path from "path";
import { DataSource } from "typeorm";
import { ObservabilityRequestEntitySchema } from "./entities/ObservabilityRequestEntity.js";
import { UserPointsBudgetEntitySchema } from "./entities/UserPointsBudgetEntity.js";
import { logger } from "../services/logger.js";

const APP_DATABASE_URL =
  process.env["APP_DATABASE_URL"] ??
  process.env["OBSERVABILITY_DATABASE_URL"] ??
  "";
const APP_DATABASE_DDL_PATH =
  process.env["APP_DATABASE_DDL_PATH"] ??
  process.env["OBSERVABILITY_DDL_PATH"] ??
  path.resolve(process.cwd(), "../db/application_postgres.sql");

let dataSource: DataSource | null = null;
let ddlApplied = false;

export function isApplicationDatabaseConfigured(): boolean {
  return APP_DATABASE_URL.length > 0;
}

function buildDataSource(): DataSource {
  if (!APP_DATABASE_URL) {
    throw new Error("APP_DATABASE_URL is required");
  }

  return new DataSource({
    type: "postgres",
    url: APP_DATABASE_URL,
    entities: [
      ObservabilityRequestEntitySchema,
      UserPointsBudgetEntitySchema,
    ],
    synchronize: false,
    logging: false,
  });
}

async function applyDdl(ds: DataSource): Promise<void> {
  if (ddlApplied) return;
  const ddl = await fs.readFile(APP_DATABASE_DDL_PATH, "utf-8");
  await ds.query(ddl);
  ddlApplied = true;
}

export async function getApplicationDataSource(): Promise<DataSource> {
  if (!dataSource) {
    dataSource = buildDataSource();
  }

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
    await applyDdl(dataSource);
    logger.info("Application PostgreSQL data source initialized");
  }

  return dataSource;
}

export async function closeApplicationDataSource(): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
  }
  dataSource = null;
  ddlApplied = false;
}
