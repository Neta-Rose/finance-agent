import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import {
  PilotFeatureCatalogFileSchema,
  type PilotFeatureCatalogEntry,
} from "../schemas/pilotFeature.js";

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVICES_DIR, "..", "..", "..");
const DEFAULT_CATALOG_DIR = path.join(PROJECT_ROOT, "docs", "pilot-features");

const UNSAFE_EVIDENCE_PATTERNS = [
  /^users(?:\/|$)/,
  /^\.env$/,
  /(?:^|\/)\.env(?:\.|$)/,
  /^backend\/\.env$/,
  /^data\/(?:tickers|reports|jobs|triggers|state|research)(?:\/|$)/,
  /^backend\/(?:dist|logs|node_modules)(?:\/|$)/,
  /^\.gsd(?:\/|$)/,
  /^\.openclaw(?:\/|$)/,
  /^memory(?:\/|$)/,
  /^canvas(?:\/|$)/,
];

export class PilotFeatureCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PilotFeatureCatalogError";
  }
}

export interface LoadPilotFeatureCatalogOptions {
  catalogDir?: string;
}

function formatZodIssuePath(pathSegments: Array<string | number>): string {
  return pathSegments.length > 0 ? pathSegments.join(".") : "<root>";
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${formatZodIssuePath(issue.path)}: ${issue.message}`)
    .join("; ");
}

function normalizeEvidencePath(evidencePath: string): string {
  return evidencePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function assertSafeEvidencePath(entry: PilotFeatureCatalogEntry, evidencePath: string, filePath: string): void {
  const normalized = normalizeEvidencePath(evidencePath);
  if (path.isAbsolute(evidencePath) || normalized.includes("../")) {
    throw new PilotFeatureCatalogError(
      `${filePath}: Unsafe evidence path for ${entry.id}: ${evidencePath}`
    );
  }
  if (UNSAFE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new PilotFeatureCatalogError(
      `${filePath}: Unsafe evidence path for ${entry.id}: ${evidencePath}`
    );
  }
}

async function parseCatalogFile(filePath: string): Promise<PilotFeatureCatalogEntry[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PilotFeatureCatalogError(`${filePath}: Malformed JSON: ${reason}`);
  }

  const result = PilotFeatureCatalogFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new PilotFeatureCatalogError(`${filePath}: ${formatZodError(result.error)}`);
  }

  for (const entry of result.data.entries) {
    for (const evidencePath of entry.evidencePaths) {
      assertSafeEvidencePath(entry, evidencePath, filePath);
    }
  }

  return result.data.entries;
}

export async function loadPilotFeatureCatalog(
  options: LoadPilotFeatureCatalogOptions = {}
): Promise<PilotFeatureCatalogEntry[]> {
  const catalogDir = options.catalogDir ?? DEFAULT_CATALOG_DIR;
  let dirents;
  try {
    dirents = await fs.readdir(catalogDir, { withFileTypes: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PilotFeatureCatalogError(`${catalogDir}: Unable to read pilot feature catalog: ${reason}`);
  }

  const files = dirents
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith(".json"))
    .map((dirent) => path.join(catalogDir, dirent.name))
    .sort((a, b) => a.localeCompare(b));

  const entries: PilotFeatureCatalogEntry[] = [];
  const seen = new Map<string, string>();
  for (const filePath of files) {
    const fileEntries = await parseCatalogFile(filePath);
    for (const entry of fileEntries) {
      const priorPath = seen.get(entry.id);
      if (priorPath) {
        throw new PilotFeatureCatalogError(
          `${filePath}: Duplicate pilot feature id ${entry.id}; first seen in ${priorPath}`
        );
      }
      seen.set(entry.id, filePath);
      entries.push(entry);
    }
  }

  return entries.sort((a, b) =>
    a.surface.localeCompare(b.surface) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}
