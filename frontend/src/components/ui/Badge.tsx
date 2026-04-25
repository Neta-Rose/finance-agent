import { clsx } from "clsx";
import type { Verdict, Confidence } from "../../types/api";
import { tConfidence } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";

interface VerdictBadgeProps {
 verdict: Verdict | string;
 size?: "sm" | "md";
}

const verdictStyles: Record<string, string> = {
 BUY: "bg-[color-mix(in_srgb,var(--color-accent-blue)_15%,transparent)] text-[var(--color-accent-blue)] border border-[color-mix(in_srgb,var(--color-accent-blue)_30%,transparent)]",
 ADD: "bg-[color-mix(in_srgb,var(--color-accent-blue)_15%,transparent)] text-[var(--color-accent-blue)] border border-[color-mix(in_srgb,var(--color-accent-blue)_30%,transparent)]",
 HOLD: "bg-[color-mix(in_srgb,var(--color-accent-green)_15%,transparent)] text-[var(--color-accent-green)] border border-[color-mix(in_srgb,var(--color-accent-green)_30%,transparent)]",
 REDUCE: "bg-[color-mix(in_srgb,var(--color-accent-yellow)_15%,transparent)] text-[var(--color-accent-yellow)] border border-[color-mix(in_srgb,var(--color-accent-yellow)_30%,transparent)]",
 SELL: "bg-[color-mix(in_srgb,var(--color-accent-red)_15%,transparent)] text-[var(--color-accent-red)] border border-[color-mix(in_srgb,var(--color-accent-red)_30%,transparent)]",
 CLOSE: "bg-[color-mix(in_srgb,var(--color-accent-red)_15%,transparent)] text-[var(--color-accent-red)] border border-[color-mix(in_srgb,var(--color-accent-red)_30%,transparent)]",
};

export function VerdictBadge({ verdict, size = "md" }: VerdictBadgeProps) {
 return (
 <span className={clsx(
 "inline-flex items-center rounded-full font-bold",
 size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
 verdictStyles[verdict] ?? "bg-[var(--color-bg-muted)] text-[var(--color-fg-muted)]"
 )}>
 {verdict}
 </span>
 );
}

interface ConfidenceBadgeProps {
 confidence: Confidence | string;
 size?: "sm" | "md";
}

const confidenceStyles: Record<string, string> = {
 high: "text-[var(--color-accent-green)]",
 medium: "text-[var(--color-accent-yellow)]",
 low: "text-[var(--color-fg-muted)]",
};

export function ConfidenceBadge({ confidence, size = "sm" }: ConfidenceBadgeProps) {
 const language = usePreferencesStore((s) => s.language);
 return (
 <span className={clsx(
 "font-medium",
 size === "sm" ? "text-[10px]" : "text-xs",
 confidenceStyles[confidence] ?? "text-[var(--color-fg-muted)]"
 )}>
 {tConfidence(confidence, language)}
 </span>
 );
}
