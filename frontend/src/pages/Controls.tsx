import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
      const actionLabel = action.replace(/_/g, " ");
      showToast(`${actionLabel} queued — you'll be notified when done`, "success");
      if (tickerRequired) setTicker("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { reason?: string; error?: string } } };
      const reason = axiosErr.response?.data?.reason || axiosErr.response?.data?.error;
      showToast(reason || `Failed to trigger ${action}`, "error");
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
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const { data: jobsData, refetch: refetchJobs, isFetching } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    staleTime: 30_000,
    refetchInterval: 15_000, // auto-refresh every 15s
  });

  const allJobs = jobsData?.jobs ?? [];

  // Jobs that are currently active (pending or running)
  const activeJobs = allJobs.filter((j) => j.status === "pending" || j.status === "running");
  // Most recent completed/failed jobs
  const recentHistory = allJobs
    .filter((j) => j.status === "completed" || j.status === "failed")
    .slice(0, 15);

  const handleJobComplete = useCallback((job: Job) => {
    const actionLabel = job.action.replace(/_/g, " ");
    if (job.status === "completed") {
      showToast(`${actionLabel}${job.ticker ? ` (${job.ticker})` : ""} completed ✓`, "success");
    } else {
      showToast(`${actionLabel}${job.ticker ? ` (${job.ticker})` : ""} failed — check logs`, "error");
    }
    // Refresh the jobs list to update UI
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }, [showToast, queryClient]);

  return (
    <>
      <TopBar
        title="Controls"
        subtitle={
          activeJobs.length > 0
            ? `${activeJobs.length} job${activeJobs.length !== 1 ? "s" : ""} active`
            : undefined
        }
        onRefresh={() => refetchJobs()}
        refreshing={isFetching}
      />

      <div className="px-4 pt-3 pb-4">
        {/* Action grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <ActionCard
            icon="📋"
            title="Daily Brief"
            description="Run today's portfolio brief"
            action="daily_brief"
            onTrigger={() => {}}
          />
          <ActionCard
            icon="📊"
            title="Full Report"
            description="Analyze all positions"
            action="full_report"
            onTrigger={() => {}}
          />
          <ActionCard
            icon="🔬"
            title="Deep Dive"
            description="Full analysis on one ticker"
            action="deep_dive"
            tickerRequired
            onTrigger={() => {}}
          />
          <ActionCard
            icon="💡"
            title="New Ideas"
            description="Weekly research scan"
            action="new_ideas"
            onTrigger={() => {}}
          />
        </div>

        {/* Active jobs */}
        {activeJobs.length > 0 && (
          <div className="mt-5 space-y-2">
            <h2 className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase">
              Active Jobs ({activeJobs.length})
            </h2>
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
          <h2 className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase mb-3">
            Recent Jobs
          </h2>

          {!jobsData ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="sm" />
            </div>
          ) : recentHistory.length === 0 && activeJobs.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-xs text-[var(--color-fg-muted)]">No jobs yet — use the buttons above to get started</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentHistory.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--color-bg-subtle)]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0">
                      {job.status === "completed" ? "✅" : "❌"}
                    </span>
                    <span className="text-xs font-medium text-[var(--color-fg-default)] truncate">
                      {job.action.replace(/_/g, " ")}
                      {job.ticker && (
                        <span className="text-[var(--color-fg-muted)]"> · {job.ticker}</span>
                      )}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--color-fg-subtle)] shrink-0">
                    {new Date(job.completed_at ?? job.triggered_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
