/**
 * rebuildIndex.ts
 * Rebuilds the paginated snapshot index for a user.
 * Usage: node dist/scripts/rebuildIndex.js <userId>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Script lives at backend/dist/scripts/rebuildIndex.js
// .env lives at backend/.env — use the script's own directory, not CWD,
// so the script works correctly regardless of where it is invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../../.env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

const USERS_DIR = process.env["USERS_DIR"] ?? "../users";
const PAGE_SIZE = 10;

interface SnapshotEntry {
  verdict: string;
  confidence: string;
  reasoning: string;
  timeframe: string;
  analystTypes: string[];
  hasBullCase: boolean;
  hasBearCase: boolean;
}

interface SnapshotMeta {
  batchId: string;
  triggeredAt: string;
  date: string;
  mode: string;
  userId: string;
  tickers: string[];
  tickerCount: number;
  entries: Record<string, SnapshotEntry>;
}

interface IndexMeta {
  totalBatches: number;
  totalPages: number;
  pageSize: number;
  lastUpdated: string | null;
  newestBatchId: string | null;
}

interface PageFile {
  page: number;
  totalPages: number;
  batches: SnapshotMeta[];
}

function usage(): void {
  console.error("Usage: node dist/scripts/rebuildIndex.js <userId>");
}

function isValidMeta(meta: unknown): meta is SnapshotMeta {
  if (typeof meta !== "object" || meta === null) return false;
  const m = meta as Record<string, unknown>;
  return (
    typeof m["batchId"] === "string" &&
    typeof m["triggeredAt"] === "string" &&
    typeof m["date"] === "string" &&
    typeof m["mode"] === "string" &&
    typeof m["userId"] === "string" &&
    Array.isArray(m["tickers"]) &&
    typeof m["tickerCount"] === "number" &&
    typeof m["entries"] === "object" &&
    m["entries"] !== null
  );
}

function padPage(n: number): string {
  return String(n).padStart(3, "0");
}

function main(): void {
  const userId = process.argv[2];

  if (!userId) {
    usage();
    process.exit(1);
  }

  // path.resolve on an absolute USERS_DIR is a no-op; on a relative one it
  // resolves from the script directory (not CWD) so agent invocations from
  // workspace dirs don't produce /users/users/... double-nesting.
  const resolvedUsersDir = path.resolve(__dirname, "../../", USERS_DIR);
  const resolvedSnapshotsDir = path.resolve(resolvedUsersDir, userId, "data", "reports", "snapshots");
  const resolvedIndexDir = path.resolve(resolvedUsersDir, userId, "data", "reports", "index");

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedSnapshotsDir, { withFileTypes: true });
  } catch {
    // Snapshots dir doesn't exist — write empty index, exit 0
    fs.mkdirSync(resolvedIndexDir, { recursive: true });
    const meta: IndexMeta = {
      totalBatches: 0,
      totalPages: 0,
      pageSize: PAGE_SIZE,
      lastUpdated: new Date().toISOString(),
      newestBatchId: null,
    };
    fs.writeFileSync(
      path.join(resolvedIndexDir, "meta.json"),
      JSON.stringify(meta, null, 2),
      "utf-8"
    );
    console.log(`Index rebuilt: 0 batches, 0 pages`);
    process.exit(0);
  }

  const batches: SnapshotMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(resolvedSnapshotsDir, entry.name, "meta.json");
    let raw: string;
    try {
      raw = fs.readFileSync(metaPath, "utf-8");
    } catch {
      console.error(`Skipping ${entry.name}/meta.json: cannot read file`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`Skipping ${entry.name}/meta.json: invalid JSON`);
      continue;
    }
    if (!isValidMeta(parsed)) {
      console.error(`Skipping ${entry.name}/meta.json: missing or invalid required fields`);
      continue;
    }
    batches.push(parsed);
  }

  // Sort newest first
  batches.sort(
    (a, b) =>
      new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
  );

  // Paginate
  const totalPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE));
  const pages: SnapshotMeta[][] = [];
  for (let i = 0; i < batches.length; i += PAGE_SIZE) {
    pages.push(batches.slice(i, i + PAGE_SIZE));
  }

  fs.mkdirSync(resolvedIndexDir, { recursive: true });

  // Write page files
  for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
    const pageBatches = pages[pageNum - 1] ?? [];
    const pageData: PageFile = {
      page: pageNum,
      totalPages,
      batches: pageBatches,
    };
    const pageFile = path.join(resolvedIndexDir, `page-${padPage(pageNum)}.json`);
    fs.writeFileSync(pageFile, JSON.stringify(pageData, null, 2), "utf-8");
  }

  // Write meta.json
  const newestBatchId = batches.length > 0 ? batches[0]!.batchId : null;
  const indexMeta: IndexMeta = {
    totalBatches: batches.length,
    totalPages,
    pageSize: PAGE_SIZE,
    lastUpdated: new Date().toISOString(),
    newestBatchId,
  };
  fs.writeFileSync(
    path.join(resolvedIndexDir, "meta.json"),
    JSON.stringify(indexMeta, null, 2),
    "utf-8"
  );

  console.log(`Index rebuilt: ${batches.length} batches, ${pages.length} pages`);
  process.exit(0);
}

main();
