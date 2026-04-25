import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { getGreeting } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";
import { ContactAdminButton } from "../support/ContactAdminButton";
import { fetchBalance } from "../../api/balance";

interface Props {
 title: string;
 subtitle?: string;
 greeting?: string;
 onRefresh?: () => void;
 refreshing?: boolean;
 right?: React.ReactNode;
 showContactAdmin?: boolean;
 contactAdminSource?: string;
 showBalance?: boolean;
}

function formatBalancePoints(points: number): string {
 if (!Number.isFinite(points)) return "0.000";
 if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`;
 if (points >= 1_000) return `${(points / 1_000).toFixed(1)}k`;
 if (points >= 100) return points.toFixed(1);
 if (points >= 10) return points.toFixed(2);
 return points.toFixed(3);
}

export function TopBar({
 title,
 subtitle,
 greeting,
 onRefresh,
 refreshing,
 right,
 showContactAdmin = true,
 contactAdminSource = "topbar",
 showBalance = true,
}: Props) {
 const lang = usePreferencesStore((s) => s.language);
 const computedGreeting = greeting !== undefined ? greeting : getGreeting(null, lang);
 const { data: balance } = useQuery({
 queryKey: ["balance"],
 queryFn: fetchBalance,
 enabled: showBalance,
 staleTime: 15_000,
 refetchInterval: 20_000,
 retry: 1,
 });
 return (
 <div className="fixed top-0 left-0 right-0 z-40 bg-[var(--color-bg-subtle)] border-b border-[var(--color-border)] safe-top">
 <div className="flex items-center justify-between px-4 h-12">
 <div>
 {greeting !== undefined ? (
 <h1 className="text-xs font-medium text-[var(--color-fg-muted)] leading-tight">{computedGreeting}</h1>
 ) : (
 <h1 className="text-sm font-bold text-[var(--color-fg-default)] leading-tight">{title}</h1>
 )}
 {subtitle && <p className="text-[10px] text-[var(--color-fg-subtle)] leading-tight">{subtitle}</p>}
 </div>
 <div className="flex items-center gap-2">
 {showBalance && balance && (
 <div
 className="flex items-center gap-2 rounded-full border px-2.5 py-1"
 style={{
 borderColor: balance.exhausted ? "rgba(239,68,68,0.35)" : "rgba(59,130,246,0.28)",
 background: balance.exhausted ? "rgba(239,68,68,0.08)" : "rgba(59,130,246,0.08)",
 }}
 >
 <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
 Balance
 </span>
 <span className={balance.exhausted ? "text-[var(--color-accent-red)] text-xs font-semibold" : "text-[var(--color-fg-default)] text-xs font-semibold"}>
 {formatBalancePoints(balance.pointsRemaining)} pts
 </span>
 </div>
 )}
 {showContactAdmin && <ContactAdminButton source={contactAdminSource} />}
 {right}
 {onRefresh && (
 <button
 onClick={onRefresh}
 className="p-2 rounded-lg text-[var(--color-fg-muted)] active:bg-[var(--color-bg-muted)]"
 >
 <RefreshCw size={16} className={clsx(refreshing && "animate-spin")} />
 </button>
 )}
 </div>
 </div>
 </div>
 );
}
