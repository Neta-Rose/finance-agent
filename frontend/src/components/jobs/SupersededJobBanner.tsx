import { AlertTriangle } from "lucide-react";
import type { Job } from "../../types/api";

interface SupersededJobBannerProps {
  jobs: Job[];
}

export function SupersededJobBanner({ jobs }: SupersededJobBannerProps) {
  const superseded = jobs.filter((j) => j.status === "superseded");
  if (superseded.length === 0) return null;

  const latest = superseded.sort((a, b) =>
    (b.triggered_at ?? "").localeCompare(a.triggered_at ?? "")
  )[0];
  const action = latest?.action ?? "job";

  return (
    <div
      role="status"
      className="mb-3 rounded-md border px-3 py-2 flex items-start gap-2 text-[13px]"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-subtle)",
        color: "var(--color-fg-default)",
      }}
    >
      <AlertTriangle
        size={16}
        className="mt-[2px] shrink-0"
        style={{ color: "var(--color-accent-red)" }}
      />
      <div>
        Your previous <span className="font-semibold">{action.replace("_", " ")}</span>{" "}
        ran into a system issue and didn't complete. A new run will be available soon.
        Your portfolio data and existing strategies are untouched.
      </div>
    </div>
  );
}
