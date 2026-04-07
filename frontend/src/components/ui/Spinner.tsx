import { clsx } from "clsx";

interface Props { size?: "sm" | "md" | "lg"; className?: string; }

export function Spinner({ size = "md", className }: Props) {
 return (
 <div
 className={clsx(
 "animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent-blue)]",
 size === "sm" && "h-4 w-4",
 size === "md" && "h-6 w-6",
 size === "lg" && "h-10 w-10",
 className
 )}
 />
 );
}
