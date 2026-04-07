import { useState, useEffect, useCallback } from "react";
import { fetchJob } from "../../api/jobs";
import type { Job } from "../../types/api";

interface JobCardProps {
  job: Job;
  onPollComplete?: (job: Job) => void;
}

function statusIcon(status: Job["status"], spinning = false) {
  switch (status) {
    case "pending":
      return <span>⏳</span>;
    case "running":
      return <span className={spinning ? "animate-spin" : ""}>🔄</span>;
    case "completed":
      return <span>✅</span>;
    case "failed":
      return <span>❌</span>;
  }
}

function statusColor(status: Job["status"]) {
  switch (status) {
    case "running": return "border-l-[var(--color-accent-blue)]";
    case "completed": return "border-l-[var(--color-accent-green)]";
    case "failed": return "border-l-[var(--color-accent-red)]";
    default: return "border-l-[var(--color-border)]";
  }
}

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function JobCard({ job: initialJob, onPollComplete }: JobCardProps) {
  const [job, setJob] = useState<Job>(initialJob);
  const [expanded, setExpanded] = useState(false);

  const poll = useCallback(async () => {
    if (job.status === "pending" || job.status === "running") {
      try {
        const updated = await fetchJob(job.id);
        setJob(updated);
        if (updated.status === "completed" || updated.status === "failed") {
          onPollComplete?.(updated);
        }
      } catch {
        // silently ignore poll errors
      }
    }
  }, [job.id, job.status, onPollComplete]);

  useEffect(() => {
    if (job.status === "pending" || job.status === "running") {
      const interval = setInterval(poll, 5000);
      return () => clearInterval(interval);
    }
  }, [poll, job.status]);

  const borderColor = statusColor(job.status);

  return (
    <div
      className={`bg-[var(--color-bg-subtle)] border border-[var(--color-border)] border-l-[3px] ${borderColor} rounded-lg px-3 py-3`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon(job.status, true)}
          <span className="text-xs font-medium text-[var(--color-fg-default)] truncate">
            {job.action}
            {job.ticker && <span className="text-[var(--color-fg-muted)]"> · {job.ticker}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-[var(--color-fg-subtle)]">
            {job.started_at ? timeAgo(job.started_at) : job.triggered_at ? timeAgo(job.triggered_at) : ""}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]"
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Progress bar for running */}
      {job.status === "running" && (
        <div className="mt-2 h-1 bg-[var(--color-bg-muted)] rounded-full overflow-hidden">
          <div className="h-full bg-[var(--color-accent-blue)] animate-pulse rounded-full" style={{ width: "60%" }} />
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 space-y-2">
          {job.status === "completed" && job.result && (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {job.result.slice(0, 200)}{job.result.length > 200 ? "…" : ""}
            </p>
          )}
          {job.status === "failed" && job.error && (
            <p className="text-xs text-[var(--color-accent-red)]">
              {job.error}
            </p>
          )}
          {job.status === "completed" && !job.result && (
            <p className="text-xs text-[var(--color-fg-subtle)]">Completed successfully.</p>
          )}
        </div>
      )}
    </div>
  );
}
