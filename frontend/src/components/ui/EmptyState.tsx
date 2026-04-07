interface Props { message: string; icon?: string; }
export function EmptyState({ message, icon = "📭" }: Props) {
 return (
 <div className="flex flex-col items-center justify-center py-16 gap-3">
 <span className="text-4xl">{icon}</span>
 <p className="text-[var(--color-fg-muted)] text-sm text-center px-6">{message}</p>
 </div>
 );
}
