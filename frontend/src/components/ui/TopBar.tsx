import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { getGreeting } from "../../store/i18n";
import { usePreferencesStore } from "../../store/preferencesStore";
import { ContactAdminButton } from "../support/ContactAdminButton";

interface Props {
 title: string;
 subtitle?: string;
 greeting?: string;
 onRefresh?: () => void;
 refreshing?: boolean;
 right?: React.ReactNode;
 showContactAdmin?: boolean;
 contactAdminSource?: string;
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
}: Props) {
 const lang = usePreferencesStore((s) => s.language);
 const computedGreeting = greeting !== undefined ? greeting : getGreeting(null, lang);
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
