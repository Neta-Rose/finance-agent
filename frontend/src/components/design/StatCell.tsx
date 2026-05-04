interface StatCellProps {
  label: string;
  value: string;
  sub?: string;
  /** When set, value renders green (true) / red (false) / default white (null) */
  positive?: boolean | null;
}

/**
 * Small metric tile — used in 2-col grids on Portfolio + Detail screens.
 *
 * Per spec section 3:
 *   - Surface bg, 10px radius
 *   - Label: 9px tertiary uppercase, 0.06em letter-spacing
 *   - Value: 15px bold (white default; green/red via positive prop)
 *   - Sub: 10px tertiary
 */
export function StatCell({ label, value, sub, positive }: StatCellProps) {
  const valueColor =
    positive === true
      ? "var(--color-green)"
      : positive === false
      ? "var(--color-red)"
      : "var(--text-primary)";

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-md)",
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-2xs)",
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 500,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: "var(--weight-bold)",
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.5px",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            marginTop: 2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
