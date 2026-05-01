import type { BuiltPrompt } from "../stepQueue/handlers.js";

export interface OneShotModel {
  primary: string;
  fallback: string | null;
}

export interface OneShotCallOptions {
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface OneShotUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface OneShotJsonResult {
  json: unknown;
  usage: OneShotUsage;
  model: string;
}

function usageFromPayload(payload: {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number | string;
  };
}): OneShotUsage {
  const rawCost = payload.usage?.cost;
  const costUsd =
    typeof rawCost === "number"
      ? rawCost
      : typeof rawCost === "string"
      ? Number(rawCost)
      : 0;
  return {
    tokensIn: payload.usage?.prompt_tokens ?? 0,
    tokensOut: payload.usage?.completion_tokens ?? 0,
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
  };
}

export async function oneShotJsonCompletion(
  prompt: BuiltPrompt,
  model: OneShotModel,
  options: OneShotCallOptions = {}
): Promise<OneShotJsonResult> {
  const endpoint = options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";
  const apiKey = options.apiKey ?? process.env["OPENROUTER_API_KEY"] ?? "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 300_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.primary,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`LLM request failed ${response.status}: ${rawText.slice(0, 500)}`);
    }

    const payload = JSON.parse(rawText) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number | string;
      };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM response did not include message content");
    return {
      json: JSON.parse(content),
      usage: usageFromPayload(payload),
      model: payload.model ?? model.primary,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function oneShotJsonCall(
  prompt: BuiltPrompt,
  model: OneShotModel,
  options: OneShotCallOptions = {}
): Promise<unknown> {
  return (await oneShotJsonCompletion(prompt, model, options)).json;
}
