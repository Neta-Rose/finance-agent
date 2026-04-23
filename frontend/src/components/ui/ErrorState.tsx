import { ContactAdminButton } from "../support/ContactAdminButton";

interface Props {
 message: string;
 onRetry?: () => void;
 contactAdminSource?: string;
}

export function ErrorState({ message, onRetry, contactAdminSource }: Props) {
 return (
 <div className="mx-4 mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-center">
 <p className="text-[var(--color-accent-red)] text-sm mb-3">{message}</p>
 <div className="flex items-center justify-center gap-2">
 {onRetry && (
 <button
 onClick={onRetry}
 className="text-xs text-[var(--color-fg-muted)] border border-[var(--color-border)] rounded px-3 py-1"
 >
 Retry
 </button>
 )}
 {contactAdminSource && (
 <ContactAdminButton
 source={contactAdminSource}
 defaultSubject="Unexpected error"
 variant="inline"
 />
 )}
 </div>
 </div>
 );
}
