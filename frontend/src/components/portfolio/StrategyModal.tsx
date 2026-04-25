import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { fetchStrategy } from "../../api/strategies";
import { triggerJob } from "../../api/jobs";
import { Spinner } from "../ui/Spinner";
import { ErrorState } from "../ui/ErrorState";
import { VerdictBadge, ConfidenceBadge } from "../ui/Badge";
import { useToastStore } from "../../store/toastStore";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t, tConfidence, tTimeframe } from "../../store/i18n";
import { timeAgo } from "../../utils/format";
import type { StrategyRow } from "../../types/api";

interface StrategyModalProps {
  ticker: string | null;
  onClose: () => void;
  onDeepDive?: (ticker: string) => void;
}

function CatalystRow({ cat }: { cat: { description: string; expiresAt: string | null; triggered: boolean } }) {
  const language = usePreferencesStore((s) => s.language);
  const isExpired = cat.expiresAt && new Date(cat.expiresAt) < new Date() && !cat.triggered;
  const isFuture = cat.expiresAt && new Date(cat.expiresAt) > new Date() && !cat.triggered;
  const daysOver = cat.expiresAt
    ? Math.floor((Date.now() - new Date(cat.expiresAt).getTime()) / 86400000)
    : 0;
  const daysUntil = cat.expiresAt
    ? Math.ceil((new Date(cat.expiresAt).getTime() - Date.now()) / 86400000)
    : 0;

  let icon = "⚪";
  let textColor = "text-[var(--color-fg-subtle)]";
  let label = t("noExpiry", language);

  if (cat.triggered) {
    icon = "✅";
    textColor = "text-[var(--color-accent-green)]";
    label = t("triggered", language);
  } else if (isExpired) {
    icon = "🔴";
    textColor = "text-[var(--color-accent-red)]";
    label = language === "he"
      ? `פג לפני ${daysOver} יום`
      : `Expired ${daysOver} day${daysOver !== 1 ? "s" : ""} ago`;
  } else if (isFuture) {
    icon = "🟡";
    textColor = "text-[var(--color-accent-yellow)]";
    label = language === "he"
      ? `יפוג בעוד ${daysUntil} יום`
      : `Expires in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`;
  }

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--color-border-muted)] last:border-0">
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--color-fg-default)] leading-snug">{cat.description}</p>
        <p className={`text-[10px] mt-0.5 ${textColor}`}>{label}</p>
      </div>
    </div>
  );
}

function StrategyContent({ strategy }: { strategy: StrategyRow }) {
  const language = usePreferencesStore((s) => s.language);
  return (
    <div className="space-y-4">
      {/* Meta row */}
      <div className="flex items-center gap-3 text-[10px] text-[var(--color-fg-muted)]">
        <ConfidenceBadge confidence={tConfidence(strategy.confidence, language)} />
        <span>·</span>
        <span>{t("strategyUpdated", language)} {timeAgo(strategy.updatedAt)}</span>
        <span>·</span>
        <span>{tTimeframe(strategy.timeframe, language)}</span>
      </div>

      {/* Reasoning */}
      <div>
        <p className="text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase mb-1.5">{t("reasoning", language)}</p>
        <p className="text-sm text-[var(--color-fg-default)] leading-relaxed">{strategy.reasoning}</p>
      </div>

      {/* Bull Case */}
      {strategy.verdict !== "BUY" && strategy.verdict !== "ADD" && (
        <div>
          <p className="text-[10px] font-medium text-[var(--color-accent-green)] uppercase mb-1.5">{t("bullCase", language)}</p>
          <p className="text-xs text-[var(--color-fg-muted)] leading-relaxed">{t("comingSoon", language)}</p>
        </div>
      )}

      {/* Bear Case */}
      {strategy.verdict !== "SELL" && strategy.verdict !== "CLOSE" && (
        <div>
          <p className="text-[10px] font-medium text-[var(--color-accent-red)] uppercase mb-1.5">{t("bearCase", language)}</p>
          <p className="text-xs text-[var(--color-fg-muted)] leading-relaxed">{t("comingSoon", language)}</p>
        </div>
      )}

      {/* Entry Conditions */}
      {strategy.entryConditions.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase mb-1.5">{t("entryConditions", language)}</p>
          <ul className="space-y-1">
            {strategy.entryConditions.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-fg-default)]">
                <span className="text-[var(--color-accent-blue)] shrink-0">•</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Exit Conditions */}
      {strategy.exitConditions.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase mb-1.5">{t("exitConditions", language)}</p>
          <ul className="space-y-1">
            {strategy.exitConditions.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-fg-default)]">
                <span className="text-[var(--color-accent-yellow)] shrink-0">•</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Catalysts */}
      {strategy.catalysts.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase mb-2">{t("catalysts", language)}</p>
          <div className="bg-[var(--color-bg-muted)] rounded-lg px-3">
            {strategy.catalysts.map((cat, i) => (
              <CatalystRow key={i} cat={cat} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function StrategyModal({ ticker, onClose, onDeepDive }: StrategyModalProps) {
  const language = usePreferencesStore((s) => s.language);
  const showToast = useToastStore((s) => s.show);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategy", ticker],
    queryFn: () => fetchStrategy(ticker!),
    enabled: !!ticker,
  });

  const handleDeepDive = async () => {
    if (!ticker) return;
    try {
      await triggerJob("deep_dive", ticker);
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
      showToast(`${t("jobDeepDiveTitle", language)} — ${ticker} ${t("jobQueued", language)}`, "success");
      onDeepDive?.(ticker);
    } catch (error) {
      const apiError = error as { response?: { data?: { reason?: string; error?: string } } };
      showToast(apiError.response?.data?.reason ?? t("jobFailed", language), "error");
    }
  };

  if (!ticker) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Sheet */}
      <div className="relative w-full bg-[var(--color-bg-subtle)] md:rounded-xl md:max-w-lg md:max-h-[85vh] flex flex-col overflow-hidden"
        style={{ maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--color-bg-subtle)] border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onClose}
              className="shrink-0 p-1 -ml-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg-default)]"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono font-bold text-[var(--color-fg-default)]">{ticker}</span>
              {data && <VerdictBadge verdict={data.verdict} size="sm" />}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-8">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" />
            </div>
          )}
          {error && (
            <ErrorState message={t("failedLoadStrategy", language)} onRetry={() => refetch()} />
          )}
          {data && <StrategyContent strategy={data} />}
        </div>

        {/* Deep Dive button */}
        {onDeepDive && data && (
          <div className="sticky bottom-0 bg-[var(--color-bg-subtle)] border-t border-[var(--color-border)] px-4 py-3 shrink-0">
            <button
              onClick={handleDeepDive}
              className="w-full py-3 rounded-lg bg-[var(--color-accent-purple)] text-white text-sm font-semibold"
            >
              {t("runDeepDive", language)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
