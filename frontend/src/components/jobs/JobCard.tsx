import { useState, useEffect, useCallback } from "react";
import { fetchJob } from "../../api/jobs";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t } from "../../store/i18n";
import type { Job } from "../../types/api";

interface JobCardProps {
  job: Job;
  onPollComplete?: (job: Job) => void;
}

function statusIcon(status: Job["status"]) {
  switch (status) {
    case "pending":  return <span className="text-base">⏳</span>;
    case "running":  return <span className="text-base animate-spin inline-block">⟳</span>;
    case "completed": return <span className="text-base">✅</span>;
    case "failed":   return <span className="text-base">❌</span>;
  }
}

function statusColor(status: Job["status"]) {
  switch (status) {
    case "running":   return "border-l-[var(--color-accent-blue)]";
    case "completed": return "border-l-[var(--color-accent-green)]";
    case "failed":    return "border-l-[var(--color-accent-red)]";
    default:          return "border-l-[var(--color-border)]";
  }
}

function elapsed(isoStart: string | null): string {
  if (!isoStart) return "";
  const secs = Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function actionLabel(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatJobResult(result: Job["result"]): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result;

  try {
    return JSON.stringify(result);
  } catch {
    return "[structured result]";
  }
}

export function JobCard({ job: initialJob, onPollComplete }: JobCardProps) {
  const language = usePreferencesStore((s) => s.language);
  const [job, setJob] = useState<Job>(initialJob);
  const [expanded, setExpanded] = useState(false);
  const [elapsedStr, setElapsedStr] = useState(() => elapsed(initialJob.started_at));

  // Update elapsed every second for running jobs
  useEffect(() => {
    if (job.status !== "running" && job.status !== "pending") return;
    setElapsedStr(elapsed(job.started_at));
    const id = setInterval(() => setElapsedStr(elapsed(job.started_at)), 1000);
    return () => clearInterval(id);
  }, [job.status, job.started_at]);

  const poll = useCallback(async () => {
    if (job.status === "pending" || job.status === "running") {
      try {
        const updated = await fetchJob(job.id);
        setJob(updated);
        if (updated.status === "completed" || updated.status === "failed") {
          onPollComplete?.(updated);
        }
      } catch { /* ignore */ }
    }
  }, [job.id, job.status, onPollComplete]);

  useEffect(() => {
    if (job.status === "pending" || job.status === "running") {
      const id = setInterval(poll, 10000);
      return () => clearInterval(id);
    }
  }, [poll, job.status]);

  // Sync if parent updates the job (e.g. jobs list refresh)
  useEffect(() => {
    setJob(initialJob);
  }, [initialJob]);

  const borderColor = statusColor(job.status);
  const prog = job.progress;
  const pct = prog?.pct ?? 0;
  const resultText = formatJobResult(job.result);

  return (
    <div
      className={`bg-[var(--color-bg-subtle)] border border-[var(--color-border)] border-l-[3px] ${borderColor} rounded-lg px-3 py-3`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon(job.status)}
          <div className="min-w-0">
            <span className="text-xs font-semibold text-[var(--color-fg-default)]">
              {actionLabel(job.action)}
              {job.ticker && (
                <span className="text-[var(--color-fg-muted)] font-normal"> · {job.ticker}</span>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {job.status === "running" && job.started_at && (
            <span className="text-[10px] font-mono text-[var(--color-accent-blue)]" aria-live="polite">
              {elapsedStr}
            </span>
          )}
          {(job.status === "completed" || job.status === "failed") && (
            <span className="text-[10px] text-[var(--color-fg-subtle)]">
              {new Date(job.completed_at ?? job.triggered_at).toLocaleString("en-US", {
                hour: "numeric", minute: "2-digit",
              })}
            </span>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)] px-1"
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Progress section for running jobs */}
      {job.status === "running" && (
        <div className="mt-2 space-y-1.5">
          {/* Current step label */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-fg-muted)] truncate">
              {prog?.currentTicker
                ? <>
                    <span className="font-mono font-bold text-[var(--color-fg-default)]">{prog.currentTicker}</span>
                    {prog.currentStep && (
                      <span> · {prog.currentStep}</span>
                    )}
                  </>
                : t("jobInitializing", language)
              }
            </span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] shrink-0 ml-2">
              {prog ? `${pct}%` : ""}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-[var(--color-bg-muted)] rounded-full overflow-hidden">
            {prog ? (
              <div
                className="h-full bg-[var(--color-accent-blue)] rounded-full transition-all duration-500"
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            ) : (
              <div className="h-full bg-[var(--color-accent-blue)] rounded-full animate-pulse" style={{ width: "20%" }} />
            )}
          </div>

          {/* Ticker count for multi-ticker jobs */}
          {prog && prog.totalTickers > 1 && (
            <div className="text-[10px] text-[var(--color-fg-subtle)]">
              {prog.completedTickers.length} / {prog.totalTickers} {t("jobTickersComplete", language)}
              {prog.remainingTickers.length > 0 && (
                <span className="ml-1 text-[var(--color-fg-subtle)]">
                  · next: {prog.remainingTickers.slice(0, 3).join(", ")}
                  {prog.remainingTickers.length > 3 && ` +${prog.remainingTickers.length - 3}`}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pt-2 border-t border-[var(--color-border)] space-y-1">
          <div className="flex gap-4 text-[10px] text-[var(--color-fg-subtle)]">
            <span>ID: <span className="font-mono">{job.id.slice(-10)}</span></span>
            {job.triggered_at && (
              <span>{t("jobQueued2", language)} {new Date(job.triggered_at).toLocaleTimeString()}</span>
            )}
          </div>
          {job.status === "completed" && resultText && (
            <p className="text-xs text-[var(--color-fg-muted)]">
              {resultText.slice(0, 200)}{resultText.length > 200 ? "…" : ""}
            </p>
          )}
          {job.status === "completed" && !resultText && (
            <p className="text-xs text-[var(--color-fg-subtle)]">{t("jobCompletedOk", language)}</p>
          )}
          {job.status === "failed" && job.error && (
            <p className="text-xs text-[var(--color-accent-red)]">{job.error}</p>
          )}
          {prog?.completedTickers && prog.completedTickers.length > 0 && (
            <p className="text-[10px] text-[var(--color-fg-subtle)]">
              {t("jobDone", language)} {prog.completedTickers.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
