import { NavLink } from "react-router-dom";
import { TrendingUp, Bell, FileText, Target, Settings } from "lucide-react";
import { clsx } from "clsx";

const tabs = [
 { to: "/portfolio", icon: TrendingUp, label: "Portfolio" },
 { to: "/alerts", icon: Bell, label: "Alerts" },
 { to: "/reports", icon: FileText, label: "Reports" },
 { to: "/strategies", icon: Target, label: "Strategies"},
 { to: "/controls", icon: Settings, label: "Controls" },
];

export function BottomNav() {
 return (
 <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-bg-subtle)] border-t border-[var(--color-border)] safe-bottom">
 <div className="flex h-14">
 {tabs.map(({ to, icon: Icon, label }) => (
 <NavLink
 key={to}
 to={to}
 className={({ isActive }) =>
 clsx(
 "flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors",
 isActive
 ? "text-[var(--color-accent-blue)]"
 : "text-[var(--color-fg-subtle)]"
 )
 }
 >
 <Icon size={20} />
 <span className="text-[10px] font-medium">{label}</span>
 </NavLink>
 ))}
 </div>
 </nav>
 );
}
