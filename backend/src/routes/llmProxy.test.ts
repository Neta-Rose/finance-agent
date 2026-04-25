import test from "node:test";
import assert from "node:assert/strict";
import {
  extractOpenRouterUsageMetrics,
  parseStreamingUsageFromText,
} from "./llmProxy.js";

test("extractOpenRouterUsageMetrics reads token counts and cost from usage payload", () => {
  assert.deepEqual(
    extractOpenRouterUsageMetrics({
      usage: {
        prompt_tokens: 194,
        completion_tokens: 2,
        cost: 0.95,
      },
    }),
    {
      tokensIn: 194,
      tokensOut: 2,
      costUsd: 0.95,
    }
  );
});

test("extractOpenRouterUsageMetrics accepts string cost and falls back safely", () => {
  assert.deepEqual(
    extractOpenRouterUsageMetrics({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        cost: "0.00014",
      },
    }),
    {
      tokensIn: 10,
      tokensOut: 4,
      costUsd: 0.00014,
    }
  );

  assert.deepEqual(extractOpenRouterUsageMetrics({ usage: { cost: "nope" } }), {
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  });
});

test("parseStreamingUsageFromText captures final streamed usage cost", () => {
  const sse = [
    'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"hi"}}]}',
    'data: {"usage":{"prompt_tokens":194,"completion_tokens":2,"cost":0.95}}',
    "data: [DONE]",
  ].join("\n");

  assert.deepEqual(parseStreamingUsageFromText(sse), {
    tokensIn: 194,
    tokensOut: 2,
    costUsd: 0.95,
    errorMessage: null,
  });
});
