import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..", "..");
const clawdRoot = path.resolve(backendRoot, "..");
const templateDir = path.join(clawdRoot, "shared", "user-workspace");
const manifestPath = path.join(templateDir, "manifest.json");

test("shared user workspace manifest points to real files", async () => {
  const raw = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as {
    sharedFiles?: string[];
    templatedFiles?: Array<{ source?: string; target?: string }>;
    emptyFiles?: string[];
  };

  assert.ok(Array.isArray(manifest.sharedFiles));
  assert.ok(Array.isArray(manifest.templatedFiles));
  assert.ok(Array.isArray(manifest.emptyFiles));

  for (const sharedFile of manifest.sharedFiles ?? []) {
    assert.equal(typeof sharedFile, "string");
    await fs.access(path.join(templateDir, sharedFile));
  }

  for (const templatedFile of manifest.templatedFiles ?? []) {
    assert.equal(typeof templatedFile.source, "string");
    assert.equal(typeof templatedFile.target, "string");
    await fs.access(path.join(templateDir, templatedFile.source as string));
  }
});
