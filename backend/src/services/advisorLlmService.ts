import { promises as fs } from "fs";
import { PROXY_BASE_URL, generateProxyKey, toProxyModel } from "./llmProxy.js";
import { getProfile, getUserProfile } from "./profileService.js";
import { searchTickerContext } from "./explorationService.js";

export interface QuickCheckAdvisorInput {
  userId: string;
  jobId?: string | null;
  ticker: string;
  verdict: string;
  confidence: string;
  reasoning: string;
  catalysts: Array<{ description: string; expiresAt: string | null; triggered: boolean }>;
  signals: string[];
  strategyHealth: string[];
  sentimentSummary: string;
}

export interface QuickCheckAdvisorOutput {
  decision: "safe" | "not_safe";
  confidence: "high" | "medium" | "low";
  summary: string;
  reasons: string[];
}

export interface NewIdeasAdvisorInput {
  userId: string;
  portfolioTickers: string[];
  candidates: Array<{
    ticker: string;
    category: string;
    label: string;
    rationale: string;
    primaryGap: string;
    secondaryGap: string | null;
    timeframe: string;
    verdict: "ADD" | "BUY";
    confidence: "medium" | "high";
  }>;
}

export interface NewIdeasAdvisorOutput {
  ideas: Array<{
    ticker: string;
    reasoning: string;
    score: number;
  }>;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

async function getUserPreferenceSummary(userId: string): Promise<string> {
  try {
    const raw = await fs.readFile(`/root/clawd/users/${userId}/USER.md`, "utf-8");
    return raw.slice(0, 1500);
  } catch {
    return "No explicit investor profile was provided. Assume disciplined portfolio management and risk-aware behavior.";
  }
}

async function getQuickCheckModel(userId: string): Promise<string | null> {
  const profileName = await getUserProfile(userId);
  const profile = await getProfile(profileName);
  if (!profile) return null;
  return toProxyModel(userId, profile.risk || profile.analysts);
}

async function getResearchersModel(userId: string): Promise<string | null> {
  const profileName = await getUserProfile(userId);
  const profile = await getProfile(profileName);
  if (!profile) return null;
  return toProxyModel(userId, profile.researchers || profile.orchestrator);
}

export async function runQuickCheckAdvisor(
  input: QuickCheckAdvisorInput
): Promise<QuickCheckAdvisorOutput | null> {
  const model = await getQuickCheckModel(input.userId);
  if (!model) return null;

  const investorProfile = await getUserPreferenceSummary(input.userId);
  const liveExploration = await searchTickerContext(input.ticker, "quick_check", 2);
  const prompt = [
    "You are a personal investment quick-check assistant.",
    'Decide only whether this position looks "safe" or "not_safe" for now.',
    '"not_safe" does NOT mean sell. It means the user should investigate with a deeper review.',
    "Be concise, practical, and risk-aware.",
    "Return JSON only with keys: decision, confidence, summary, reasons.",
    "",
    `Investor profile summary:\n${investorProfile}`,
    "",
    `Ticker: ${input.ticker}`,
    `Current strategy verdict: ${input.verdict} (${input.confidence})`,
    `Strategy reasoning: ${input.reasoning}`,
    `Catalysts: ${input.catalysts.map((item) => `${item.description} | expiresAt=${item.expiresAt ?? "none"} | triggered=${item.triggered}`).join(" || ") || "none"}`,
    `System signals: ${input.signals.join(" | ") || "none"}`,
    `Strategy health issues: ${input.strategyHealth.join(" | ") || "none"}`,
    `Latest information summary: ${input.sentimentSummary}`,
    `Exploration snippets: ${
      liveExploration.length > 0
        ? liveExploration.map((item) => `${item.title} | ${item.summary}`).join(" || ")
        : "none"
    }`,
  ].join("\n");

  try {
    const response = await fetch(`${PROXY_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${generateProxyKey(input.userId)}`,
        "x-clawd-purpose": "quick_check",
        ...(input.jobId ? { "x-clawd-job-id": input.jobId } : {}),
        "x-clawd-ticker": input.ticker,
        "x-clawd-analyst": "advisor",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: "Return strict JSON only. Never provide prose outside the JSON object.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const json = extractJsonObject(content);
    if (!json) return null;

    const parsed = JSON.parse(json) as QuickCheckAdvisorOutput;
    if (
      (parsed.decision !== "safe" && parsed.decision !== "not_safe") ||
      !["high", "medium", "low"].includes(parsed.confidence) ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.reasons)
    ) {
      return null;
    }

    return {
      decision: parsed.decision,
      confidence: parsed.confidence,
      summary: parsed.summary,
      reasons: parsed.reasons.slice(0, 5).map((reason) => String(reason)),
    };
  } catch {
    return null;
  }
}

export async function runNewIdeasAdvisor(
  input: NewIdeasAdvisorInput
): Promise<NewIdeasAdvisorOutput | null> {
  const model = await getResearchersModel(input.userId);
  if (!model) return null;

  const investorProfile = await getUserPreferenceSummary(input.userId);
  const explorationByTicker = await Promise.all(
    input.candidates.map(async (candidate) => ({
      ticker: candidate.ticker,
      snippets: await searchTickerContext(candidate.ticker, "new_ideas", 2),
    }))
  );

  const prompt = [
    "You are selecting the best new investment ideas for a personal advisor product.",
    "Choose up to 4 ideas from the candidate list.",
    "Prefer ideas that fill true portfolio gaps and fit the investor profile.",
    "Do not choose a ticker already in the portfolio.",
    "Return JSON only with key: ideas.",
    'Each idea must contain: ticker, reasoning, score. Score is 0-100.',
    "",
    `Investor profile summary:\n${investorProfile}`,
    `Current portfolio tickers: ${input.portfolioTickers.join(", ") || "none"}`,
    "",
    `Candidates:\n${input.candidates.map((candidate) => [
      `ticker=${candidate.ticker}`,
      `category=${candidate.category}`,
      `label=${candidate.label}`,
      `rationale=${candidate.rationale}`,
      `primaryGap=${candidate.primaryGap}`,
      `secondaryGap=${candidate.secondaryGap ?? "none"}`,
      `timeframe=${candidate.timeframe}`,
      `baseVerdict=${candidate.verdict}`,
    ].join(" | ")).join("\n")}`,
    "",
    `Exploration snippets:\n${explorationByTicker
      .map((entry) => `${entry.ticker}: ${
        entry.snippets.length > 0
          ? entry.snippets.map((snippet) => `${snippet.title} | ${snippet.summary}`).join(" || ")
          : "none"
      }`)
      .join("\n")}`,
  ].join("\n");

  try {
    const response = await fetch(`${PROXY_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${generateProxyKey(input.userId)}`,
        "x-clawd-purpose": "new_ideas",
        "x-clawd-analyst": "advisor",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "Return strict JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const json = extractJsonObject(content);
    if (!json) return null;

    const parsed = JSON.parse(json) as NewIdeasAdvisorOutput;
    if (!parsed || !Array.isArray(parsed.ideas)) return null;

    return {
      ideas: parsed.ideas
        .map((idea) => ({
          ticker: String(idea.ticker ?? "").toUpperCase(),
          reasoning: String(idea.reasoning ?? ""),
          score: Number(idea.score ?? 0),
        }))
        .filter((idea) => idea.ticker && idea.reasoning)
        .slice(0, 4),
    };
  } catch {
    return null;
  }
}
