import { DebateReportSchema } from "../../../schemas/analysts.js";
import { gatherAnalystArtifacts, gatherCommonInputs, makePromptHandler, persistReportArtifact } from "../handlerUtils.js";

type Evidence = {
  source: string;
  claim: string;
  dataPoint: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function sourcesFromArtifacts(artifacts: Record<string, unknown>): string[] {
  const sources = Object.values(artifacts)
    .flatMap((artifact) => {
      const sourceValue = asRecord(artifact)["sources"];
      return Array.isArray(sourceValue) ? sourceValue : [];
    })
    .filter((source): source is string => typeof source === "string" && source.startsWith("http"));
  return Array.from(new Set(sources)).slice(0, 8);
}

function evidence(source: string, claim: string, dataPoint: string): Evidence {
  return {
    source,
    claim: claim.slice(0, 200),
    dataPoint: dataPoint.slice(0, 200),
  };
}

function buildDebate(inputs: { step: { ticker: string }; data: Record<string, unknown> }) {
  const artifacts = asRecord(inputs.data["analystArtifacts"]);
  const fundamentals = asRecord(artifacts["fundamentals"]);
  const technical = asRecord(artifacts["technical"]);
  const sentiment = asRecord(artifacts["sentiment"]);
  const macro = asRecord(artifacts["macro"]);
  const risk = asRecord(artifacts["risk"]);
  const sources = sourcesFromArtifacts(artifacts);
  const primarySource = sources[0] ?? "https://finance.yahoo.com/";
  const plPct = typeof risk["plPct"] === "number" ? risk["plPct"] : null;
  const weightPct = typeof risk["portfolioWeightPct"] === "number" ? risk["portfolioWeightPct"] : null;
  const riskFacts = stringValue(risk["riskFacts"], "Risk snapshot did not provide detailed facts.");
  const fundamentalView = stringValue(fundamentals["fundamentalView"], "Fundamental data is limited.");
  const technicalView = stringValue(technical["technicalView"], "Technical data is neutral or limited.");
  const sentimentView = stringValue(sentiment["sentimentView"], "Market sentiment is treated as stable.");
  const macroView = stringValue(macro["macroView"], "Macro context is mixed.");
  const riskVerdict = weightPct !== null && weightPct >= 25 ? "REDUCE" : plPct !== null && plPct <= -30 ? "REDUCE" : "HOLD";

  return {
    ticker: inputs.step.ticker,
    generatedAt: new Date().toISOString(),
    analyst: "debate",
    bullRounds: [
      {
        round: 1,
        thesis: `Bull case: keep optionality in ${inputs.step.ticker} while the available fundamentals and technicals do not prove an urgent exit.`,
        evidence: [
          evidence(primarySource, fundamentalView, "Fundamentals artifact"),
          evidence(sources[1] ?? primarySource, technicalView, "Technical artifact"),
        ],
        responseToBear: "Position risk is real, so the bull case depends on keeping sizing disciplined and requiring fresh catalysts.",
      },
      {
        round: 2,
        thesis: "Bull rebuttal: absent a clear negative catalyst, a measured hold/add decision should wait for stronger confirming data.",
        evidence: [
          evidence(sources[2] ?? primarySource, sentimentView, "Sentiment artifact"),
          evidence(sources[3] ?? primarySource, macroView, "Macro artifact"),
        ],
        responseToBear: "If risk metrics deteriorate or thesis evidence remains thin, the bull case should step aside.",
      },
    ],
    bearRounds: [
      {
        round: 1,
        concern: `Bear case: ${riskFacts}`,
        evidence: [
          evidence(sources[4] ?? primarySource, riskFacts, "Risk artifact"),
          evidence(sources[5] ?? primarySource, macroView, "Macro artifact"),
        ],
        responseToBull: "Low-confidence positives are not enough if downside or concentration risk is high.",
      },
      {
        round: 2,
        concern: "Bear rebuttal: deterministic low-cost data is sparse, so the safest pilot output should avoid high-conviction upside claims.",
        evidence: [
          evidence(sources[6] ?? primarySource, technicalView, "Technical artifact"),
          evidence(sources[7] ?? primarySource, sentimentView, "Sentiment artifact"),
        ],
        responseToBull: "A better bull case requires fresher catalysts, cleaner trend support, or stronger fundamentals.",
      },
    ],
    bullFinalVerdict: "HOLD",
    bearFinalVerdict: riskVerdict,
    keyDisagreement: "Whether limited low-cost evidence is enough to maintain exposure versus reducing risk until a stronger catalyst appears.",
    synthesisGuidance: "Use a low-confidence provisional verdict. Penalize oversized positions and large drawdowns; require dated catalysts before a confident HOLD.",
    sources: sources.length > 0 ? sources : [primarySource],
  };
}

export const debateHandler = makePromptHandler({
  kind: "debate",
  analyst: "debate",
  schema: DebateReportSchema,
  schemaName: "DebateReportSchema",
  async gatherData(step, ws) {
    return {
      ...(await gatherCommonInputs(step, ws)),
      analystArtifacts: await gatherAnalystArtifacts(ws, step.ticker),
    };
  },
  async callRaw(inputs) {
    return buildDebate(inputs);
  },
  artifactPath: persistReportArtifact("debate"),
  buildUserPrompt(inputs) {
    return [
      `User: ${inputs.step.userId}`,
      `Job: ${inputs.step.jobId}`,
      `Step: ${inputs.step.id}`,
      `Ticker: ${inputs.step.ticker}`,
      "Run a bounded bull/bear debate using only the five analyst artifacts and current portfolio context.",
      "Produce two concise bull rounds, two concise bear rounds, final verdicts from each side, and synthesis guidance.",
      "Schema requirements: analyst='debate'; evidence sources must be valid URLs.",
      JSON.stringify(inputs.data, null, 2),
    ].join("\n\n");
  },
});
