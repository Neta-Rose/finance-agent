import { useToastStore } from "../../store/toastStore";
import { clsx } from "clsx";
import { X } from "lucide-react";

const typeStyles = {
 success: "bg-green-500/15 border-green-500/30 text-[var(--color-accent-green)]",
 error: "bg-red-500/15 border-red-500/30 text-[var(--color-accent-red)]",
 warning: "bg-yellow-500/15 border-yellow-500/30 text-[var(--color-accent-yellow)]",
 info: "bg-blue-500/15 border-blue-500/30 text-[var(--color-accent-blue)]",
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
