import { clsx } from "clsx";
import type { Verdict, Confidence } from "../../types/api";

interface VerdictBadgeProps {
 verdict: Verdict | string;
 size?: "sm" | "md";
}

const verdictStyles: Record<string, string> = {
 BUY: "bg-blue-500/15 text-[var(--color-accent-blue)] border border-blue-500/30",
 ADD: "bg-blue-500/15 text-[var(--color-accent-blue)] border border-blue-500/30",
 HOLD: "bg-green-500/15 text-[var(--color-accent-green)] border border-green-500/30",
 REDUCE: "bg-yellow-500/15 text-[var(--color-accent-yellow)] border border-yellow-500/30",
 SELL: "bg-red-500/15 text-[var(--color-accent-red)] border border-red-500/30",
 CLOSE: "bg-red-500/15 text-[var(--color-accent-red)] border border-red-500/30",
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
 return (
 <span className={clsx(
 "font-medium",
 size === "sm" ? "text-[10px]" : "text-xs",
 confidenceStyles[confidence] ?? "text-[var(--color-fg-muted)]"
 )}>
 {confidence}
 </span>
 );
}
