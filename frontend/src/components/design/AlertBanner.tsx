interface AlertBannerProps {
  count: number;
  /** Optional click handler — anchors to the alert items section */
  onClick?: () => void;
}

/**
 * Top-of-portfolio strip — "{N} need attention".
 *
 * Per spec section 3:
 *   - Hide entirely when count === 0 (silence is the message)
 *   - Square left edge with 2px amber accent border (no rounding on left)
 *   - Small dot indicator left of text
 */
export function AlertBanner({ count, onClick }: AlertBannerProps) {
  if (count <= 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        background: "var(--color-amber-bg)",
        borderInlineStart: "2px solid var(--color-amber)",
        borderRadius: 0,
        width: "100%",
        textAlign: "start",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--color-amber)",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: "var(--text-xs)",
          fontWeight: 500,
          color: "rgba(224, 160, 48, 0.85)",
        }}
      >
        {count === 1 ? "1 needs attention" : `${count} need attention`}
      </span>
    </button>
  );
}
