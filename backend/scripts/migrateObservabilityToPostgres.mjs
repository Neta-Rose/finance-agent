import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const backupPath =
  process.env.OBSERVABILITY_SQLITE_EXPORT_PATH ??
  path.resolve("/root/clawd/data/observability-export.json");
const databaseUrl = process.env.OBSERVABILITY_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("OBSERVABILITY_DATABASE_URL is required");
}

const raw = await fs.readFile(backupPath, "utf-8");
const rows = JSON.parse(raw);
if (!Array.isArray(rows)) {
  throw new Error(`Invalid observability export payload at ${backupPath}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("BEGIN");

  for (const row of rows) {
    await client.query(
      `INSERT INTO llm_requests
        (id, user_id, purpose, ticker, job_id, source_class, analyst, model,
         tokens_in, tokens_out, cost_usd, latency_ms, status, error_message,
         attribution_source, rejection_reason, occurred_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.user_id,
        row.purpose,
        row.ticker,
        row.job_id,
        row.source_class,
        row.analyst,
        row.model,
        row.tokens_in,
        row.tokens_out,
        row.cost_usd,
        row.latency_ms,
        row.status,
        row.error_message,
        row.attribution_source,
        row.rejection_reason,
        row.occurred_at,
      ]
    );
  }

  await client.query(
    `SELECT setval(
      pg_get_serial_sequence('llm_requests', 'id'),
      COALESCE((SELECT MAX(id) FROM llm_requests), 1),
      true
    )`
  );

  await client.query("COMMIT");
  console.log(JSON.stringify({ migratedRows: rows.length, backupPath }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
