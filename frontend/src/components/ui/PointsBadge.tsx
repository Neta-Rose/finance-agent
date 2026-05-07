import { useQuery } from "@tanstack/react-query";
import { fetchBalance } from "../../api/balance";

/**
 * Global points badge — shown in the top-right of every protected page.
 * When exhausted, shows time until the 24h window resets.
 */

function timeUntilReset(windowEnd: string): string {
  const ms = new Date(windowEnd).getTime() - Date.now();
  if (ms <= 0) return "soon";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function PointsBadge() {
  const { data: balance } = useQuery({
    queryKey: ["balance"],
    queryFn: fetchBalance,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  if (!balance) return null;

  const label = balance.exhausted
    ? `Resets in ${timeUntilReset(balance.windowEnd)}`
    : balance.pointsRemaining >= 1000
    ? `${(balance.pointsRemaining / 1000).toFixed(1)}k pts`
    : `${balance.pointsRemaining.toFixed(0)} pts`;

  return (
    <div
      style={{
        position: "fixed",
        top: "env(safe-area-inset-top, 0px)",
        right: 12,
        zIndex: 50,
        marginTop: 10,
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        border: `0.5px solid ${balance.exhausted ? "rgba(226,80,80,0.35)" : "rgba(66,201,122,0.28)"}`,
        background: balance.exhausted ? "rgba(226,80,80,0.08)" : "rgba(66,201,122,0.08)",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: balance.exhausted ? "var(--color-red)" : "var(--color-green)",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
    </div>
  );
}
