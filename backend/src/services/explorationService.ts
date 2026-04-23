const EXA_API_BASE = "https://api.exa.ai";

export interface ExplorationSnippet {
  title: string;
  url: string;
  summary: string;
}

export async function searchTickerContext(
  ticker: string,
  purpose: "quick_check" | "new_ideas" | "deep_dive" | "percolation",
  limit = 3
): Promise<ExplorationSnippet[]> {
  const apiKey = process.env["EXA_API_KEY"];
  if (!apiKey) return [];

  try {
    const response = await fetch(`${EXA_API_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query: `${ticker} latest news and analysis for ${purpose.replace(/_/g, " ")}`,
        numResults: limit,
        type: "auto",
        text: true,
      }),
    });

    if (!response.ok) return [];
    const payload = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        text?: string;
      }>;
    };

    return (payload.results ?? [])
      .slice(0, limit)
      .map((result) => ({
        title: result.title ?? ticker,
        url: result.url ?? "",
        summary: (result.text ?? "").slice(0, 500),
      }))
      .filter((result) => result.url);
  } catch {
    return [];
  }
}
