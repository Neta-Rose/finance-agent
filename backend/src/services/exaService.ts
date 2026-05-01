import { promises as fs } from "fs";
import path from "path";
import { resolveConfiguredPath } from "./paths.js";

const EXA_API_BASE = "https://api.exa.ai";
const DATA_DIR = resolveConfiguredPath(process.env["DATA_DIR"], "../data");
const CACHE_DIR = path.join(DATA_DIR, "cache", "exa");

export interface ExaSearchResult {
  title: string;
  url: string;
  text: string;
  publishedDate: string | null;
}

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function cachePath(query: string, day = dayKey()): string {
  const safe = Buffer.from(query).toString("base64url").slice(0, 180);
  return path.join(CACHE_DIR, day, `${safe}.json`);
}

async function readCache(query: string): Promise<ExaSearchResult[] | null> {
  try {
    const raw = await fs.readFile(cachePath(query), "utf-8");
    const parsed = JSON.parse(raw) as { results?: ExaSearchResult[] };
    return parsed.results ?? null;
  } catch {
    return null;
  }
}

async function writeCache(query: string, results: ExaSearchResult[]): Promise<void> {
  const filePath = cachePath(query);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ cachedAt: new Date().toISOString(), results }, null, 2), "utf-8");
}

export async function searchExaCached(query: string, limit = 5): Promise<ExaSearchResult[]> {
  const cached = await readCache(query);
  if (cached) return cached.slice(0, limit);

  const apiKey = process.env["EXA_API_KEY"];
  if (!apiKey) return [];

  const response = await fetch(`${EXA_API_BASE}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: limit,
      type: "auto",
      text: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`exa_http_${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      text?: string;
      publishedDate?: string;
    }>;
  };
  const results = (payload.results ?? [])
    .map((item) => ({
      title: item.title ?? "Untitled",
      url: item.url ?? "",
      text: (item.text ?? "").slice(0, 2000),
      publishedDate: item.publishedDate ?? null,
    }))
    .filter((item) => item.url);
  await writeCache(query, results);
  return results.slice(0, limit);
}
