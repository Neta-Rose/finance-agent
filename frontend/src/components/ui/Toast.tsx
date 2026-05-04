import { useToastStore } from "../../store/toastStore";
import { X } from "lucide-react";

/**
 * Toast type → design-pivot tokens.
 *   success → green, error → red, warning/info → amber.
 */
const TOAST_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  success: {
    bg: "var(--color-green-bg)",
    border: "var(--color-green-border)",
    color: "var(--color-green)",
  },
  error: {
    bg: "var(--color-red-bg)",
    border: "var(--color-red-border)",
    color: "var(--color-red)",
  },
  warning: {
    bg: "var(--color-amber-bg)",
    border: "var(--color-amber-border)",
    color: "var(--color-amber)",
  },
  info: {
    bg: "var(--color-amber-bg)",
    border: "var(--color-amber-border)",
    color: "var(--color-amber)",
  },
};

/**
 * Fixed overlay above all modals (z-index 100 > modal z-50).
 * Bottom-anchored above the nav so it doesn't disrupt scroll flow.
 * Per design pivot section 8 — toasts must NEVER inject into the document flow.
 */
export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: "fixed",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        bottom: "calc(72px + env(safe-area-inset-bottom))",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "0 16px",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        const style = TOAST_STYLE[toast.type] ?? TOAST_STYLE.info!;
        return (
          <div
            key={toast.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              border: `0.5px solid ${style.border}`,
              background: style.bg,
              color: style.color,
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              pointerEvents: "auto",
              boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              style={{
                flexShrink: 0,
                opacity: 0.7,
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
