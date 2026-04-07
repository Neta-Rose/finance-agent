import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { triggerJob, fetchJobs } from "../api/jobs";
import { TopBar } from "../components/ui/TopBar";
import { Card } from "../components/ui/Card";
import { JobCard } from "../components/jobs/JobCard";
import { Spinner } from "../components/ui/Spinner";
import { useToastStore } from "../store/toastStore";
import type { Job, JobAction } from "../types/api";

function ActionCard({
  icon,
  title,
  description,
  action,
  tickerRequired,
  onTrigger,
}: {
  icon: string;
  title: string;
  description: string;
  action: JobAction;
  tickerRequired?: boolean;
  onTrigger: (job: Job) => void;
}) {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const showToast = useToastStore((s) => s.show);

  const handleTrigger = async () => {
    if (tickerRequired && !ticker.trim()) {
      showToast("Enter a ticker symbol", "warning");
      return;
    }
    setLoading(true);
    try {
      const res = await triggerJob(action, tickerRequired ? ticker.trim().toUpperCase() : undefined);
      onTrigger(res.job);
      showToast(`${action} triggered`, "success");
      if (tickerRequired) setTicker("");
    } catch {
      showToast("Failed to trigger action", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="text-2xl">{icon}</div>
      <div>
        <h3 className="text-sm font-bold text-[var(--color-fg-default)]">{title}</h3>
        <p className="text-[10px] text-[var(--color-fg-muted)] mt-0.5">{description}</p>
      </div>
      {tickerRequired && (
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 10))}
          placeholder="TICKER"
          className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)] mt-1"
        />
      )}
      <button
        onClick={handleTrigger}
        disabled={loading}
        className="w-full py-2 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold disabled:opacity-50 mt-1"
      >
        {loading ? "..." : "Run"}
      </button>
    </Card>
  );
}

export function Controls() {
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const showToast = useToastStore((s) => s.show);

  const { data: jobsData, refetch: refetchJobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    staleTime: 30_000,
  });

  const handleJobComplete = useCallback((job: Job) => {
    showToast(
      `${job.action}${job.ticker ? ` (${job.ticker})` : ""} ${job.status}`,
      job.status === "completed" ? "success" : "error"
    );
  }, [showToast]);

  const recentJobs = jobsData?.jobs.slice(0, 20) ?? [];

  return (
    <>
      <TopBar title="Controls" />

      <div className="px-4 pt-3 pb-4">
        {/* Action grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ActionCard
            icon="📋"
            title="Daily Brief"
            description="Run today's portfolio brief"
            action="daily_brief"
            onTrigger={(job) => setActiveJobs((prev) => [job, ...prev])}
          />
          <ActionCard
            icon="📊"
            title="Full Report"
            description="Analyze all positions"
            action="full_report"
            onTrigger={(job) => setActiveJobs((prev) => [job, ...prev])}
          />
          <ActionCard
            icon="🔬"
            title="Deep Dive"
            description="Full analysis on one ticker"
            action="deep_dive"
            tickerRequired
            onTrigger={(job) => setActiveJobs((prev) => [job, ...prev])}
          />
          <ActionCard
            icon="💡"
            title="New Ideas"
            description="Weekly research scan"
            action="new_ideas"
            onTrigger={(job) => setActiveJobs((prev) => [job, ...prev])}
          />
          <ActionCard
            icon="⚙️"
            title="Testing Mode"
            description="Switch to test models"
            action="switch_testing"
            onTrigger={(job) => setActiveJobs((prev) => [job, ...prev])}
          />
          <ActionCard
            icon="⚙️"
            title="Production Mode"
            description="Switch to production models"
            action="switch_production"
            onTrigger={(job) => setActiveJobs((prev) => [job, ...prev])}
          />
        </div>

        {/* Active job cards */}
        {activeJobs.length > 0 && (
          <div className="mt-5 space-y-2">
            <h2 className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase">Active Jobs</h2>
            {activeJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onPollComplete={handleJobComplete}
              />
            ))}
          </div>
        )}

        {/* Job history */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase">Recent Jobs</h2>
            <button
              onClick={() => refetchJobs()}
              className="text-[10px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]"
            >
              Refresh
            </button>
          </div>

          {!jobsData ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="sm" />
            </div>
          ) : recentJobs.length === 0 ? (
            <p className="text-xs text-[var(--color-fg-muted)] text-center py-6">No jobs yet</p>
          ) : (
            <div className="space-y-1.5">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-[var(--color-bg-subtle)] cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0">
                      {job.status === "completed" ? "✅" : job.status === "failed" ? "❌" : job.status === "running" ? "🔄" : "⏳"}
                    </span>
                    <span className="text-xs font-medium text-[var(--color-fg-default)] truncate">
                      {job.action}
                      {job.ticker && <span className="text-[var(--color-fg-muted)]"> · {job.ticker}</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {job.result && job.status === "completed" && (
                      <span className="text-[10px] text-[var(--color-fg-subtle)] hidden md:inline">
                        {job.result.slice(0, 60)}{job.result.length > 60 ? "…" : ""}
                      </span>
                    )}
                    {job.error && job.status === "failed" && (
                      <span className="text-[10px] text-[var(--color-accent-red)] hidden md:inline">
                        {job.error.slice(0, 60)}{job.error.length > 60 ? "…" : ""}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--color-fg-subtle)]">
                      {new Date(job.triggered_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
