import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchVerdicts } from "../api/portfolio";
import { fetchConditionCheck } from "../api/conditions";
import { fetchOnboardStatus } from "../api/onboarding";
import { triggerJob } from "../api/jobs";
import { TopBar } from "../components/ui/TopBar";
import { StrategyModal } from "../components/portfolio/StrategyModal";
import { VerdictBadge, ConfidenceBadge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { ErrorState } from "../components/ui/ErrorState";
import { useToastStore } from "../store/toastStore";
import { usePreferencesStore } from "../store/preferencesStore";
import { t, tConfidence, tTimeframe, getGreeting } from "../store/i18n";

export function Alerts() {
  const language = usePreferencesStore((s) => s.language);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const showToast = useToastStore((s) => s.show);

  const { data: verdictsData, isLoading, error, refetch } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    staleTime: 60_000,
  });

  const { data: conditions } = useQuery({
    queryKey: ["conditions"],
    queryFn: fetchConditionCheck,
    staleTime: 5 * 60 * 1000,
  });

  const { data: onboardStatus } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    staleTime: 60_000,
  });

  const { critical, warning, opportunities, isEmpty } = useMemo(() => {
    if (!verdictsData) return { critical: [], warning: [], opportunities: [], isEmpty: true };
    const v = verdictsData.verdicts;
    return {
      critical: v.filter((x) => x.verdict === "SELL" || x.verdict === "CLOSE"),
      warning: v.filter((x) => x.verdict === "REDUCE"),
      opportunities: v.filter((x) => x.verdict === "BUY" || x.verdict === "ADD"),
      isEmpty: v.length === 0,
    };
  }, [verdictsData]);

  const escalationCount = conditions?.needsEscalation?.length ?? 0;

  const handleRunFullReport = async () => {
    try {
      await triggerJob("full_report");
      showToast(t("fullReportStarted", language), "success");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; reason?: string } } };
      const msg = axiosErr.response?.data?.reason || axiosErr.response?.data?.error;
      showToast(msg || t("errorStartFullReport", language), "error");
    }
  };

  if (isLoading) {
    return (
      <>
        <TopBar title={t("alerts", language)} />
        <div className="flex items-center justify-center h-48">
          <Spinner size="lg" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <TopBar title={t("alerts", language)} />
        <ErrorState message={t("errorLoadAlerts", language)} onRetry={refetch} />
      </>
    );
  }

  const subtitle = escalationCount > 0
    ? `${escalationCount} ${t("alertsNeedAttention", language)}`
    : undefined;

  return (
    <>
      <TopBar
        title={t("alerts", language)}
        subtitle={subtitle}
        greeting={getGreeting(onboardStatus?.displayName, language)}
      />

      {/* Escalation banner */}
      {escalationCount > 0 && (
        <div className="mx-4 mt-3 mb-1 flex items-center justify-between gap-3 bg-[var(--color-accent-yellow)]/10 border border-[var(--color-accent-yellow)]/30 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-[var(--color-accent-yellow)]">
            <span>⚡</span>
            <span className="font-medium">
              {escalationCount} {t("escalationNeeds", language)}
            </span>
          </div>
          <button
            onClick={handleRunFullReport}
            className="shrink-0 text-[10px] font-semibold text-[var(--color-accent-yellow)] border border-[var(--color-accent-yellow)]/40 rounded px-2 py-1"
          >
            {t("runNow", language)}
          </button>
        </div>
      )}

      <div className="px-4 pb-8 space-y-6">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="text-4xl">✅</span>
            <p className="text-sm text-[var(--color-fg-muted)] text-center">{t("emptyAlerts", language)}</p>
          </div>
        ) : (
          <>
            {critical.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-[var(--color-accent-red)] uppercase mb-2 flex items-center gap-1.5">
                  <span>🔴</span> {t("alertCritical", language)}
                </h2>
                <div className="space-y-2">
                  {critical.map((v) => (
                    <div
                      key={v.ticker}
                      onClick={() => setSelectedTicker(v.ticker)}
                      className="bg-[var(--color-bg-subtle)] border-l-[3px] border-l-[var(--color-accent-red)] border border-[var(--color-border)] rounded-r-lg px-3 py-3 cursor-pointer active:opacity-80"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-sm text-[var(--color-fg-default)]">{v.ticker}</span>
                          <VerdictBadge verdict={v.verdict} size="sm" />
                        </div>
                        <ConfidenceBadge confidence={tConfidence(v.confidence, language)} />
                      </div>
                      <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{tTimeframe(v.timeframe, language)}</p>
                      <p className="text-xs text-[var(--color-fg-muted)] leading-snug line-clamp-2">
                        {v.reasoning.slice(0, 120)}{v.reasoning.length > 120 ? "…" : ""}
                      </p>
                      {v.hasExpiredCatalysts && (
                        <p className="text-[10px] text-[var(--color-accent-red)] mt-1">🔴 {t("expiredCatalyst", language)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {warning.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-[var(--color-accent-yellow)] uppercase mb-2 flex items-center gap-1.5">
                  <span>⚠️</span> {t("alertWarning", language)}
                </h2>
                <div className="space-y-2">
                  {warning.map((v) => (
                    <div
                      key={v.ticker}
                      onClick={() => setSelectedTicker(v.ticker)}
                      className="bg-[var(--color-bg-subtle)] border-l-[3px] border-l-[var(--color-accent-yellow)] border border-[var(--color-border)] rounded-r-lg px-3 py-3 cursor-pointer active:opacity-80"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-sm text-[var(--color-fg-default)]">{v.ticker}</span>
                          <VerdictBadge verdict={v.verdict} size="sm" />
                        </div>
                        <ConfidenceBadge confidence={tConfidence(v.confidence, language)} />
                      </div>
                      <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{tTimeframe(v.timeframe, language)}</p>
                      <p className="text-xs text-[var(--color-fg-muted)] leading-snug line-clamp-2">
                        {v.reasoning.slice(0, 120)}{v.reasoning.length > 120 ? "…" : ""}
                      </p>
                      {v.hasExpiredCatalysts && (
                        <p className="text-[10px] text-[var(--color-accent-yellow)] mt-1">🟡 {t("expiredCatalyst", language)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {opportunities.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-[var(--color-accent-blue)] uppercase mb-2 flex items-center gap-1.5">
                  <span>🔵</span> {t("alertOpportunities", language)}
                </h2>
                <div className="space-y-2">
                  {opportunities.map((v) => (
                    <div
                      key={v.ticker}
                      onClick={() => setSelectedTicker(v.ticker)}
                      className="bg-[var(--color-bg-subtle)] border-l-[3px] border-l-[var(--color-accent-blue)] border border-[var(--color-border)] rounded-r-lg px-3 py-3 cursor-pointer active:opacity-80"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-sm text-[var(--color-fg-default)]">{v.ticker}</span>
                          <VerdictBadge verdict={v.verdict} size="sm" />
                        </div>
                        <ConfidenceBadge confidence={tConfidence(v.confidence, language)} />
                      </div>
                      <p className="text-[10px] text-[var(--color-fg-subtle)] mb-1">{tTimeframe(v.timeframe, language)}</p>
                      <p className="text-xs text-[var(--color-fg-muted)] leading-snug line-clamp-2">
                        {v.reasoning.slice(0, 120)}{v.reasoning.length > 120 ? "…" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <StrategyModal
        ticker={selectedTicker}
        onClose={() => setSelectedTicker(null)}
      />
    </>
  );
}
