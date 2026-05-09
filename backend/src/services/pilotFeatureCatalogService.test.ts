import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { loadPilotFeatureCatalog } from "./pilotFeatureCatalogService.js";

const baseEntry = {
  id: "web.portfolio",
  surface: "web",
  title: "Portfolio overview",
  shortSummary: "Shows the user's portfolio health and holdings.",
  detailedExplanation: "The portfolio page summarizes holdings, account grouping, active analysis jobs, and attention items derived from current verdicts.",
  happyPath: ["Authenticated user opens /portfolio", "Portfolio API data renders holdings and health summary"],
  edgeCases: ["Empty portfolio shows an empty state", "Fetch failure renders a retryable error state"],
  errorHandling: ["Portfolio query failures render ErrorState instead of stale or blank data"],
  evidencePaths: ["frontend/src/pages/Portfolio.tsx", "frontend/src/App.tsx"],
  pilotRecommendation: "pilot",
};

async function writeCatalog(dir: string, fileName: string, value: unknown): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), JSON.stringify(value, null, 2), "utf-8");
}

async function makeCatalogDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pilot-feature-catalog-"));
}

function assertCatalogEntryContract(entry: typeof baseEntry): void {
  assert.equal(typeof entry.id, "string");
  assert.match(entry.id, /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
  assert.ok(["admin", "operator", "telegram", "web"].includes(entry.surface));
  assert.equal(typeof entry.title, "string");
  assert.equal(typeof entry.shortSummary, "string");
  assert.equal(typeof entry.detailedExplanation, "string");
  assert.ok(entry.title.trim().length > 0);
  assert.ok(entry.shortSummary.trim().length > 0);
  assert.ok(entry.detailedExplanation.trim().length > 0);
  assert.ok(Array.isArray(entry.happyPath) && entry.happyPath.length > 0);
  assert.ok(Array.isArray(entry.edgeCases) && entry.edgeCases.length > 0);
  assert.ok(Array.isArray(entry.errorHandling) && entry.errorHandling.length > 0);
  assert.ok(Array.isArray(entry.evidencePaths) && entry.evidencePaths.length > 0);
  assert.ok(["pilot", "beta", "defer", "hide"].includes(entry.pilotRecommendation));
}

test("pilot feature catalog loads valid entries and sorts by surface, title, and id", async () => {
  const catalogDir = await makeCatalogDir();
  await writeCatalog(catalogDir, "pilot-core.json", {
    entries: [
      { ...baseEntry, id: "web.zeta", title: "Zeta", surface: "web" },
      { ...baseEntry, id: "telegram.daily-brief", title: "Daily brief delivery", surface: "telegram", evidencePaths: ["backend/src/routes/telegram.ts"] },
      { ...baseEntry, id: "web.alpha-b", title: "Alpha", surface: "web" },
      { ...baseEntry, id: "web.alpha-a", title: "Alpha", surface: "web" },
    ],
  });

  const entries = await loadPilotFeatureCatalog({ catalogDir });

  assert.deepEqual(entries.map((entry) => entry.id), [
    "telegram.daily-brief",
    "web.alpha-a",
    "web.alpha-b",
    "web.zeta",
  ]);
  assert.equal(entries[0]?.errorHandling.length, 1);
});

test("default pilot feature catalog includes substantive Web, Telegram, and admin coverage", async () => {
  const entries = await loadPilotFeatureCatalog();
  const ids = new Set(entries.map((entry) => entry.id));
  const webEntries = entries.filter((entry) => entry.surface === "web");
  const telegramEntries = entries.filter((entry) => entry.surface === "telegram");
  const adminEntries = entries.filter((entry) => entry.surface === "admin");

  assert.ok(entries.length >= 8);
  assert.ok(webEntries.length >= 5);
  assert.ok(telegramEntries.length >= 1);
  assert.ok(adminEntries.length >= 1);
  assert.ok(ids.has("web.onboarding-portfolio"));
  assert.ok(ids.has("telegram.daily-brief-chat"));
  for (const entry of entries) {
    assertCatalogEntryContract(entry);
    assert.ok(entry.shortSummary.length > 20);
  }
});

test("pilot feature catalog rejects duplicate feature ids across files", async () => {
  const catalogDir = await makeCatalogDir();
  await writeCatalog(catalogDir, "a.json", { entries: [baseEntry] });
  await writeCatalog(catalogDir, "b.json", { entries: [{ ...baseEntry, title: "Duplicate title" }] });

  await assert.rejects(
    () => loadPilotFeatureCatalog({ catalogDir }),
    /Duplicate pilot feature id web\.portfolio/
  );
});

test("pilot feature catalog rejects schema violations with file path and reason", async () => {
  const catalogDir = await makeCatalogDir();
  const invalid = { ...baseEntry } as Record<string, unknown>;
  delete invalid["errorHandling"];
  await writeCatalog(catalogDir, "invalid.json", { entries: [invalid] });

  await assert.rejects(
    () => loadPilotFeatureCatalog({ catalogDir }),
    /invalid\.json.*entries\.0\.errorHandling.*Required/s
  );
});

test("pilot feature catalog rejects malformed JSON with file path and parse reason", async () => {
  const catalogDir = await makeCatalogDir();
  await fs.mkdir(catalogDir, { recursive: true });
  await fs.writeFile(path.join(catalogDir, "broken.json"), "{ not json", "utf-8");

  await assert.rejects(
    () => loadPilotFeatureCatalog({ catalogDir }),
    /broken\.json.*Malformed JSON/s
  );
});

test("pilot feature catalog rejects unsafe evidence paths", async () => {
  const catalogDir = await makeCatalogDir();
  await writeCatalog(catalogDir, "unsafe.json", {
    entries: [
      { ...baseEntry, id: "unsafe.users", evidencePaths: ["users/alice/private.json"] },
      { ...baseEntry, id: "unsafe.env", evidencePaths: ["backend/.env"] },
      { ...baseEntry, id: "unsafe.runtime", evidencePaths: ["data/reports/batch.json"] },
    ],
  });

  await assert.rejects(
    () => loadPilotFeatureCatalog({ catalogDir }),
    /Unsafe evidence path.*users\/alice\/private\.json/s
  );
});
