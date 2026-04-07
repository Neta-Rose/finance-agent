interface Props { message: string; onRetry?: () => void; }
export function ErrorState({ message, onRetry }: Props) {
 return (
 <div className="mx-4 mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-center">
 <p className="text-[var(--color-accent-red)] text-sm mb-3">{message}</p>
 {onRetry && (
 <button
 onClick={onRetry}
 className="text-xs text-[var(--color-fg-muted)] border border-[var(--color-border)] rounded px-3 py-1"
 >
 Retry
 </button>
 )}
 </div>
 );
}
