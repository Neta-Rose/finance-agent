export function formatILS(value: number | null | undefined): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}₪${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}₪${(abs / 1_000).toFixed(0)}K`;
  }
  return `${sign}₪${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(isoString);
}

export function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const now = new Date();
  const year = d.getFullYear();
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  if (year === now.getFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${year}`;
}

export function plColor(pl: number | null | undefined): string {
  if (pl == null) return "text-[var(--color-fg-muted)]";
  if (pl > 0) return "text-[var(--color-accent-green)]";
  if (pl < 0) return "text-[var(--color-accent-red)]";
  return "text-[var(--color-fg-muted)]";
}
