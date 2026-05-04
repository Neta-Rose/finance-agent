import { Loader2 } from "lucide-react";
import { t, tInterpolate } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";

interface SetupBannerProps {
  analyzed: number;
  total: number;
  inProgressTickers: string[];
  telegramConnected: boolean;
}

/**
 * Setup-state banner — shown while state === "BOOTSTRAPPING" or UNINITIALIZED.
 * Honest about state (no fake attention items), shows live progress, channel-aware copy.
 */
export function SetupBanner({
  analyzed,
  total,
  inProgressTickers,
  telegramConnected,
}: SetupBannerProps) {
  const language = usePreferencesStore((s) => s.language);

  const body = telegramConnected
    ? t("setupBannerBodyTelegram", language)
    : t("setupBannerBodyChannelAgnostic", language);

  const progress =
    total > 0
      ? tInterpolate(t("setupBannerProgress", language), { analyzed, total })
      : null;

  const inProgress =
    inProgressTickers.length > 0
      ? tInterpolate(t("setupBannerInProgress", language), {
          tickers: inProgressTickers.slice(0, 3).join(", "),
        })
      : null;

  return (
    <div className="mx-4 mt-3 mb-1 px-4 py-3 rounded-xl border border-[var(--color-accent-blue)]/30 bg-[color-mix(in_srgb,var(--color-accent-blue)_8%,transparent)]">
      <div className="flex items-center gap-2 mb-1">
        <Loader2
          size={16}
          className="animate-spin text-[var(--color-accent-blue)] shrink-0"
        />
        <h2 className="text-sm font-bold text-[var(--color-fg-default)]">
          {t("setupBannerTitle", language)}
        </h2>
      </div>
      <p className="text-xs text-[var(--color-fg-muted)] mb-1">{body}</p>
      {(progress || inProgress) && (
        <p className="text-[11px] text-[var(--color-fg-subtle)] tabular-nums">
          {progress}
          {progress && inProgress ? <> · {inProgress}</> : inProgress}
        </p>
      )}
    </div>
  );
}
