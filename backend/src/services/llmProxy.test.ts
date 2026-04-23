import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveProxyMetadata,
  shouldAllowProxyRequest,
  toUpstreamModel,
} from "./llmProxy.js";

test("resolveProxyMetadata prefers explicit proxy headers", () => {
  const metadata = resolveProxyMetadata(
    {
      "x-clawd-purpose": "quick_check",
      "x-clawd-ticker": "AAPL",
      "x-clawd-analyst": "advisor",
    },
    "orchestrator",
    { id: "job_existing", action: "deep_dive", ticker: "TSM", source: "backend_job" }
  );

  assert.deepEqual(metadata, {
    purpose: "quick_check",
    ticker: "AAPL",
    jobId: null,
    sourceClass: "backend_job",
    analyst: "advisor",
    attributionSource: "explicit_header",
  });
});

test("resolveProxyMetadata keeps explicit job ids when provided", () => {
  const metadata = resolveProxyMetadata(
    {
      "x-clawd-purpose": "quick_check",
      "x-clawd-job-id": "job_quick_check",
      "x-clawd-ticker": "AAPL",
      "x-clawd-analyst": "advisor",
    },
    "orchestrator",
    { id: "job_existing", action: "deep_dive", ticker: "TSM", source: "backend_job" }
  );

  assert.equal(metadata.jobId, "job_quick_check");
});

test("resolveProxyMetadata falls back to active job metadata", () => {
  const metadata = resolveProxyMetadata({}, "fundamentals", {
    id: "job_test_deep_dive",
    action: "deep_dive",
    ticker: "TSM",
    source: "backend_job",
  });

  assert.deepEqual(metadata, {
    purpose: "deep_dive",
    ticker: "TSM",
    jobId: "job_test_deep_dive",
    sourceClass: "backend_job",
    analyst: "fundamentals",
    attributionSource: "active_job",
  });
});

test("resolveProxyMetadata classifies unattributed no-job traffic as unknown agent session", () => {
  const metadata = resolveProxyMetadata({}, "orchestrator", null);

  assert.deepEqual(metadata, {
    purpose: "direct_chat",
    ticker: null,
    jobId: null,
    sourceClass: "unknown_agent_session",
    analyst: "orchestrator",
    attributionSource: "inferred_direct_chat",
  });
});

test("resolveProxyMetadata keeps explicit direct chat separate from unknown sessions", () => {
  const metadata = resolveProxyMetadata(
    {
      "x-clawd-purpose": "direct_chat",
      "x-clawd-source": "direct_chat",
    },
    "orchestrator",
    null
  );

  assert.deepEqual(metadata, {
    purpose: "direct_chat",
    ticker: null,
    jobId: null,
    sourceClass: "direct_chat",
    analyst: "orchestrator",
    attributionSource: "explicit_header",
  });
});

test("resolveProxyMetadata classifies structured OpenClaw conversation metadata as direct chat", () => {
  const metadata = resolveProxyMetadata(
    {},
    "orchestrator",
    null,
    [
      {
        role: "user",
        content: `Conversation info (untrusted metadata):
\`\`\`json
{"message_id":"8","sender_id":"6365619726"}
\`\`\`

Sender (untrusted metadata):
\`\`\`json
{"label":"Neta","id":"6365619726","name":"Neta"}
\`\`\`

Hi`,
      },
    ]
  );

  assert.deepEqual(metadata, {
    purpose: "direct_chat",
    ticker: null,
    jobId: null,
    sourceClass: "direct_chat",
    analyst: "orchestrator",
    attributionSource: "conversation_metadata",
  });
});

test("resolveProxyMetadata still blocks plain no-job unattributed traffic without conversation metadata", () => {
  const metadata = resolveProxyMetadata(
    {},
    "orchestrator",
    null,
    [{ role: "user", content: "Hi" }]
  );

  assert.deepEqual(metadata, {
    purpose: "direct_chat",
    ticker: null,
    jobId: null,
    sourceClass: "unknown_agent_session",
    analyst: "orchestrator",
    attributionSource: "inferred_direct_chat",
  });
});

test("shouldAllowProxyRequest allows explicit direct chat and structured jobs, but blocks unknown sessions without triggers", () => {
  assert.equal(
    shouldAllowProxyRequest("neta", {
      purpose: "direct_chat",
      ticker: null,
      jobId: null,
      sourceClass: "direct_chat",
      analyst: "orchestrator",
      attributionSource: "explicit_header",
    }),
    true
  );

  assert.equal(
    shouldAllowProxyRequest("neta", {
      purpose: "deep_dive",
      ticker: "TSM",
      jobId: "job_test_deep_dive",
      sourceClass: "backend_job",
      analyst: "fundamentals",
      attributionSource: "active_job",
    }),
    true
  );

  assert.equal(
    shouldAllowProxyRequest("neta", {
      purpose: "direct_chat",
      ticker: null,
      jobId: null,
      sourceClass: "unknown_agent_session",
      analyst: "orchestrator",
      attributionSource: "inferred_direct_chat",
    }),
    false
  );

  assert.equal(
    shouldAllowProxyRequest(
      "neta",
      {
        purpose: "direct_chat",
        ticker: null,
        jobId: null,
        sourceClass: "unknown_agent_session",
        analyst: "orchestrator",
        attributionSource: "inferred_direct_chat",
      },
      true
    ),
    true
  );

  assert.equal(
    shouldAllowProxyRequest("main", {
      purpose: "direct_chat",
      ticker: null,
      jobId: null,
      sourceClass: "unknown_agent_session",
      analyst: "orchestrator",
      attributionSource: "inferred_direct_chat",
    }),
    true
  );
});

test("toUpstreamModel strips the synthetic per-user proxy prefix", () => {
  assert.equal(
    toUpstreamModel("clawd-neta/google/gemini-2.5-flash"),
    "google/gemini-2.5-flash"
  );
  assert.equal(
    toUpstreamModel("openrouter/google/gemini-2.5-flash"),
    "openrouter/google/gemini-2.5-flash"
  );
});
