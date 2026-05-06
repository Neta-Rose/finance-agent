import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAnalystConfig, patchAnalystConfig } from "../api/analystConfig";
import { useToastStore } from "../store/toastStore";

const STEP_LABELS: Record<string, { label: string; description: string }> = {
  "analyst.fundamentals": {
    label: "Fundamentals",
    description: "EPS, revenue, P/E, analyst consensus",
  },
  "analyst.technical": {
    label: "Technical",
    description: "MA50/MA200, RSI, MACD, key levels",
  },
  "analyst.sentiment": {
    label: "Sentiment",
    description: "News, analyst actions, narrative shift",
  },
  "analyst.macro": {
    label: "Macro",
    description: "Rates, sector performance, USD/ILS",
  },
  "analyst.risk": {
    label: "Risk",
    description: "Position sizing, drawdown, concentration",
  },
};

/**
 * Analyst pipeline configuration panel.
 * Shown in Settings — lets users toggle which analysts run on their deep dives.
 */
export function AnalystPipelineConfig() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const { data, isLoading } = useQuery({
    queryKey: ["analyst-config"],
    queryFn: fetchAnalystConfig,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: ({ stepKind, enabled }: { stepKind: string; enabled: boolean }) =>
      patchAnalystConfig(stepKind, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["analyst-config"] });
    },
    onError: () => {
      showToast("Failed to update analyst config", "error");
    },
  });

  if (isLoading || !data) return null;

  const totalCost = data.config
    .filter((c) => c.enabled)
    .reduce((sum, c) => sum + c.costPoints, 0);

  // Add debate + synthesis fixed cost
  const fixedCost = (data.costPoints["debate"] ?? 15) + (data.costPoints["synthesis"] ?? 12);
  const estimatedTotal = totalCost + fixedCost;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--color-fg-subtle)" }}>
          Analyst Pipeline
        </p>
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            background: "var(--color-bg-muted)",
            color: "var(--color-fg-muted)",
          }}
        >
          ~{estimatedTotal} pts / deep dive
        </span>
      </div>

      <p className="text-xs" style={{ color: "var(--color-fg-subtle)" }}>
        Disable analysts you don't need to save budget points. Debate and synthesis always run.
      </p>

      <div className="space-y-2">
        {data.config.map((entry) => {
          const meta = STEP_LABELS[entry.stepKind];
          if (!meta) return null;
          return (
            <div
              key={entry.stepKind}
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
              style={{
                background: "var(--color-bg-subtle)",
                border: "1px solid var(--color-border)",
                opacity: entry.enabled ? 1 : 0.5,
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: "var(--color-fg-default)" }}>
                  {meta.label}
                </p>
                <p className="text-xs truncate" style={{ color: "var(--color-fg-subtle)" }}>
                  {meta.description}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs tabular-nums" style={{ color: "var(--color-fg-muted)" }}>
                  {entry.costPoints} pts
                </span>
                <button
                  role="switch"
                  aria-checked={entry.enabled}
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({ stepKind: entry.stepKind, enabled: !entry.enabled })
                  }
                  className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50"
                  style={{
                    background: entry.enabled ? "var(--color-green)" : "var(--color-bg-muted)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <span
                    className="pointer-events-none inline-block h-4 w-4 rounded-full shadow transition-transform duration-200"
                    style={{
                      background: "#fff",
                      transform: entry.enabled ? "translateX(16px)" : "translateX(1px)",
                      marginTop: 1,
                    }}
                  />
                </button>
              </div>
            </div>
          );
        })}

        {/* Fixed steps — always on */}
        {["debate", "synthesis"].map((kind) => (
          <div
            key={kind}
            className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
            style={{
              background: "var(--color-bg-subtle)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--color-fg-default)" }}>
                {kind === "debate" ? "Bull/Bear Debate" : "Strategy Synthesis"}
              </p>
              <p className="text-xs" style={{ color: "var(--color-fg-subtle)" }}>
                {kind === "debate" ? "Required — synthesizes analyst views" : "Required — produces final verdict"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs tabular-nums" style={{ color: "var(--color-fg-muted)" }}>
                {data.costPoints[kind] ?? (kind === "debate" ? 15 : 12)} pts
              </span>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-subtle)" }}
              >
                always on
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
