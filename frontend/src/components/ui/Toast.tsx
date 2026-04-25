import { useToastStore } from "../../store/toastStore";
import { clsx } from "clsx";
import { X } from "lucide-react";

const typeStyles = {
 success: "bg-[color-mix(in_srgb,var(--color-accent-green)_15%,transparent)] border-[color-mix(in_srgb,var(--color-accent-green)_30%,transparent)] text-[var(--color-accent-green)]",
 error: "bg-[color-mix(in_srgb,var(--color-accent-red)_15%,transparent)] border-[color-mix(in_srgb,var(--color-accent-red)_30%,transparent)] text-[var(--color-accent-red)]",
 warning: "bg-[color-mix(in_srgb,var(--color-accent-yellow)_15%,transparent)] border-[color-mix(in_srgb,var(--color-accent-yellow)_30%,transparent)] text-[var(--color-accent-yellow)]",
 info: "bg-[color-mix(in_srgb,var(--color-accent-blue)_15%,transparent)] border-[color-mix(in_srgb,var(--color-accent-blue)_30%,transparent)] text-[var(--color-accent-blue)]",
};

export function ToastContainer() {
 const { toasts, dismiss } = useToastStore();
 if (!toasts.length) return null;
 return (
 <div className="fixed bottom-20 left-0 right-0 z-50 flex flex-col gap-2 px-4 pointer-events-none">
 {toasts.map((t) => (
 <div
 key={t.id}
 className={clsx(
 "flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg pointer-events-auto",
 typeStyles[t.type]
 )}
 >
 <span>{t.message}</span>
 <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-70">
 <X size={14} />
 </button>
 </div>
 ))}
 </div>
 );
}
