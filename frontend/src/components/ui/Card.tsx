import { clsx } from "clsx";

interface Props {
 children: React.ReactNode;
 className?: string;
 onClick?: () => void;
 accent?: "green" | "yellow" | "red" | "blue" | "purple" | "none";
}

const accentColors = {
 green: "border-l-[3px] border-l-[var(--color-accent-green)]",
 yellow: "border-l-[3px] border-l-[var(--color-accent-yellow)]",
 red: "border-l-[3px] border-l-[var(--color-accent-red)]",
 blue: "border-l-[3px] border-l-[var(--color-accent-blue)]",
 purple: "border-l-[3px] border-l-[var(--color-accent-purple)]",
 none: "",
};

export function Card({ children, className, onClick, accent = "none" }: Props) {
 return (
 <div
 onClick={onClick}
 className={clsx(
 "bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg",
 accentColors[accent],
 onClick && "cursor-pointer active:opacity-80",
 className
 )}
 >
 {children}
 </div>
 );
}
