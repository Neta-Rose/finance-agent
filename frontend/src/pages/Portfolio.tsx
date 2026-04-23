import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, FolderPlus, Layers3 } from "lucide-react";
import {
  fetchPortfolio,
  fetchVerdicts,
  addAccount,
  deleteAccount,
  deletePosition,
} from "../api/portfolio";
import { fetchOnboardStatus } from "../api/onboarding";
import { fetchJobs } from "../api/jobs";
import { triggerJob } from "../api/jobs";
import { TopBar } from "../components/ui/TopBar";
import { SummaryStrip } from "../components/portfolio/SummaryStrip";
import { PositionRow } from "../components/portfolio/PositionRow";
import { PositionDetailModal } from "../components/portfolio/PositionDetailModal";
import { Spinner } from "../components/ui/Spinner";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { Card } from "../components/ui/Card";
import { formatILS } from "../utils/format";
import { usePreferencesStore } from "../store/preferencesStore";
import { useToastStore } from "../store/toastStore";
import { t, getGreeting } from "../store/i18n";
import { AddPositionModal } from "../components/portfolio/AddPositionModal";
import type { VerdictRow, PositionRow as PositionRowType } from "../types/api";

interface AccountSummary {
  name: string;
  positions: PositionRowType[];
  totalILS: number;
  totalCostILS: number;
  totalPlILS: number;
  totalPlPct: number;
}

interface AccountManagerModalProps {
  open: boolean;
  accounts: AccountSummary[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}

function AccountManagerModal({
  open,
  accounts,
  onClose,
  onCreate,
  onDelete,
}: AccountManagerModalProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center">
        <div className="w-full bg-[var(--color-bg-base)] rounded-t-2xl sm:rounded-2xl sm:max-w-lg sm:w-full max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div>
              <h2 className="text-sm font-bold text-[var(--color-fg-default)]">Manage Accounts</h2>
              <p className="text-[11px] text-[var(--color-fg-subtle)]">Create empty accounts or remove empty ones.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)] text-xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="px-4 py-4 space-y-4">
            <Card className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-2">
                Add Account
              </p>
              <div className="flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Interactive Brokers"
                  className="flex-1 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
                />
                <button
                  type="button"
                  disabled={!name.trim() || saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onCreate(name.trim());
                      setName("");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl bg-[var(--color-accent-blue)] text-white text-sm font-semibold disabled:opacity-50"
                >
                  {saving ? "Adding..." : "Add"}
                </button>
              </div>
            </Card>

            <div className="space-y-2">
              {accounts.map((account) => (
                <Card key={account.name} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-fg-default)]">{account.name}</p>
                      <p className="text-[11px] text-[var(--color-fg-subtle)]">
                        {account.positions.length} positions · {formatILS(account.totalILS)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={account.positions.length > 0}
                      onClick={() => onDelete(account.name)}
                      className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-fg-muted)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Remove
                    </button>
                  </div>
                  {account.positions.length > 0 && (
                    <p className="mt-2 text-[10px] text-[var(--color-fg-subtle)]">
                      Move or remove positions from this account before deleting it.
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function Portfolio() {
  const language = usePreferencesStore((s) => s.language);
  const showToast = useToastStore((s) => s.show);
  const queryClient = useQueryClient();

  const [selectedPosition, setSelectedPosition] = useState<PositionRowType | null>(null);
  const [addPositionOpen, setAddPositionOpen] = useState(false);
  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [accountManagerOpen, setAccountManagerOpen] = useState(false);
  const [combinedHoldingsOpen, setCombinedHoldingsOpen] = useState(false);
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});

  const { data: portfolio, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: verdictsData } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    staleTime: 60_000,
  });

  const { data: onboardStatus } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    staleTime: 60_000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    staleTime: 30_000,
    refetchInterval: 15_000,
  });

  const verdictMap = useMemo(() => {
    const map: Record<string, VerdictRow> = {};
    verdictsData?.verdicts.forEach((verdict) => {
      map[verdict.ticker] = verdict;
    });
    return map;
  }, [verdictsData]);

  useEffect(() => {
    if (editingTicker && portfolio) {
      const position = portfolio.positions.find((item) => item.ticker === editingTicker) ?? null;
      setSelectedPosition(position);
      setEditingTicker(null);
    }
  }, [editingTicker, portfolio]);

  const alertTickers = useMemo(() => {
    const set = new Set<string>();
    verdictsData?.verdicts.forEach((verdict) => {
      if (["SELL", "REDUCE", "CLOSE"].includes(verdict.verdict) || verdict.hasExpiredCatalysts) {
        set.add(verdict.ticker);
      }
    });
    return set;
  }, [verdictsData]);

  const { winners, losers } = useMemo(() => {
    if (!portfolio) return { winners: 0, losers: 0 };
    return {
      winners: portfolio.positions.filter((position) => position.plPct > 0).length,
      losers: portfolio.positions.filter((position) => position.plPct < 0).length,
    };
  }, [portfolio]);

  const activeJobs = useMemo(() => {
    if (!jobsData?.jobs) return [];
    return jobsData.jobs.filter((job) => job.status === "pending" || job.status === "running");
  }, [jobsData]);

  const activeTickerChecks = useMemo(() => {
    const set = new Set<string>();
    for (const job of activeJobs) {
      if (job.ticker && (job.action === "deep_dive" || job.action === "quick_check")) {
        set.add(job.ticker);
      }
    }
    return set;
  }, [activeJobs]);

  // Map ticker to active job type
  const tickerJobType = useMemo(() => {
    const map = new Map<string, 'quick_check' | 'deep_dive'>();
    for (const job of activeJobs) {
      if (job.ticker && (job.action === "quick_check" || job.action === "deep_dive")) {
        map.set(job.ticker, job.action as 'quick_check' | 'deep_dive');
      }
    }
    return map;
  }, [activeJobs]);



  const accountSummaries = useMemo<AccountSummary[]>(() => {
    if (!portfolio) return [];

    const livePriceByTicker = new Map(
      portfolio.positions.map((position) => [position.ticker, position.livePriceILS])
    );
    const staleByTicker = new Map(
      portfolio.positions.map((position) => [position.ticker, position.priceStale])
    );
    const exchangeByTicker = new Map(
      portfolio.positions.map((position) => [position.ticker, position.exchange])
    );

    const accountMap = new Map<string, AccountSummary>();
    for (const position of portfolio.positions) {
      for (const breakdown of position.accountBreakdown) {
        const livePriceILS = livePriceByTicker.get(position.ticker) ?? 0;
        const currentILS = Math.round(livePriceILS * breakdown.shares * 100) / 100;
        const costILS = Math.round(breakdown.avgPriceILS * breakdown.shares * 100) / 100;
        const plILS = Math.round((currentILS - costILS) * 100) / 100;
        const plPct = costILS > 0 ? Math.round((plILS / costILS) * 10000) / 100 : 0;

        const summary = accountMap.get(breakdown.account) ?? {
          name: breakdown.account,
          positions: [],
          totalILS: 0,
          totalCostILS: 0,
          totalPlILS: 0,
          totalPlPct: 0,
        };

        summary.positions.push({
          ticker: position.ticker,
          exchange: exchangeByTicker.get(position.ticker) ?? position.exchange,
          shares: breakdown.shares,
          accounts: [breakdown.account],
          accountBreakdown: [breakdown],
          avgPriceILS: breakdown.avgPriceILS,
          livePriceILS,
          currentILS,
          costILS,
          plILS,
          plPct,
          weightPct: 0,
          priceStale: staleByTicker.get(position.ticker) ?? position.priceStale,
        });
        summary.totalILS += currentILS;
        summary.totalCostILS += costILS;
        accountMap.set(breakdown.account, summary);
      }
    }

    const summaries = Array.from(accountMap.values()).map((summary) => {
      summary.totalILS = Math.round(summary.totalILS * 100) / 100;
      summary.totalCostILS = Math.round(summary.totalCostILS * 100) / 100;
      summary.totalPlILS = Math.round((summary.totalILS - summary.totalCostILS) * 100) / 100;
      summary.totalPlPct = summary.totalCostILS > 0
        ? Math.round((summary.totalPlILS / summary.totalCostILS) * 10000) / 100
        : 0;

      summary.positions = summary.positions
        .map((position) => ({
          ...position,
          weightPct: summary.totalILS > 0
            ? Math.round((position.currentILS / summary.totalILS) * 10000) / 100
            : 0,
        }))
        .sort((a, b) => b.currentILS - a.currentILS);
      return summary;
    });

    for (const accountName of portfolio.accounts) {
      if (!accountMap.has(accountName)) {
        summaries.push({
          name: accountName,
          positions: [],
          totalILS: 0,
          totalCostILS: 0,
          totalPlILS: 0,
          totalPlPct: 0,
        });
      }
    }

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }, [portfolio]);

  useEffect(() => {
    if (accountSummaries.length === 0) return;
    setExpandedAccounts((current) => {
      const next = { ...current };
      let changed = false;
      for (const account of accountSummaries) {
        if (!(account.name in next)) {
          next[account.name] = false;
          changed = true;
        }
      }
      for (const name of Object.keys(next)) {
        if (!accountSummaries.find((account) => account.name === name)) {
          delete next[name];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [accountSummaries]);

  const handlePositionClick = (position: PositionRowType) => {
    setSelectedPosition(position);
  };

  const toggleAccount = (name: string) => {
    setExpandedAccounts((current) => ({
      ...current,
      [name]: !current[name],
    }));
  };

  const refreshPortfolio = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
      queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["verdicts"] }),
    ]);
    refetch();
  };

  const handleCreateAccount = async (name: string) => {
    try {
      await addAccount(name);
      showToast("Account added", "success");
      await refreshPortfolio();
    } catch (error) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const reason = apiError.response?.data?.error;
      showToast(
        reason === "account_exists"
          ? "Account already exists"
          : reason === "invalid_account_name"
          ? "Use a short account name with letters, numbers, spaces, _ or -"
          : "Failed to add account",
        "error"
      );
    }
  };

  const handleDeleteAccount = async (name: string) => {
    try {
      await deleteAccount(name);
      showToast("Account removed", "success");
      await refreshPortfolio();
    } catch (error) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const reason = apiError.response?.data?.error;
      showToast(
        reason === "account_not_empty"
          ? "Account still has positions"
          : "Failed to remove account",
        "error"
      );
    }
  };

  const handleDeleteSelectedPosition = async (position: PositionRowType) => {
    const account = position.accounts[0];
    if (!account) return;
    try {
      await deletePosition(position.ticker, account);
      showToast("Position removed", "success");
      setSelectedPosition(null);
      await refreshPortfolio();
    } catch {
      showToast("Failed to remove position", "error");
    }
  };

  const handleQuickCheck = async (ticker: string) => {
    try {
      await triggerJob("quick_check", ticker);
      showToast(`Quick check queued for ${ticker}`, "success");
      await refreshPortfolio();
    } catch (error) {
      const apiError = error as { response?: { data?: { error?: string; reason?: string } } };
      const reason = apiError.response?.data?.reason;
      showToast(reason ?? `Failed to queue quick check for ${ticker}`, "error");
    }
  };

  if (isLoading) {
    return (
      <>
        <TopBar title={t("portfolio", language)} />
        <div className="flex items-center justify-center h-48">
          <Spinner size="lg" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <TopBar title={t("portfolio", language)} />
        <ErrorState message={t("errorLoadPortfolio", language)} onRetry={refetch} />
      </>
    );
  }

  if (!portfolio) {
    return (
      <>
        <TopBar title={t("portfolio", language)} />
        <EmptyState message={t("emptyPortfolio", language)} icon="📭" />
      </>
    );
  }

  return (
    <>
      <TopBar
        title={t("portfolio", language)}
        subtitle={formatILS(portfolio.totalILS ?? null)}
        greeting={getGreeting(onboardStatus?.displayName, language)}
        onRefresh={refetch}
        refreshing={isFetching}
        right={(
          <button
            onClick={() => setAccountManagerOpen(true)}
            className="p-2 rounded-lg text-[var(--color-fg-muted)] active:bg-[var(--color-bg-muted)]"
            title="Manage accounts"
          >
            <FolderPlus size={16} />
          </button>
        )}
      />

      {activeJobs.length > 0 && (
        <div className="mx-4 mt-3 mb-1">
          <div className="flex items-center gap-2 text-xs text-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 border border-[var(--color-accent-blue)]/30 rounded-lg px-3 py-2">
            <span className="animate-spin">🔄</span>
            <span className="font-medium">
              {activeJobs.length} {t("jobsRunning", language)}
            </span>
            <div className="flex-1" />
            <div className="h-1.5 w-24 bg-[var(--color-bg-muted)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--color-accent-blue)] animate-pulse rounded-full" style={{ width: "60%" }} />
            </div>
          </div>
        </div>
      )}

      <SummaryStrip
        totalILS={portfolio.totalILS ?? 0}
        totalPlILS={portfolio.totalPlILS ?? 0}
        totalPlPct={portfolio.totalPlPct ?? 0}
        positionCount={portfolio.positions.length}
        winners={winners}
        losers={losers}
        usdIlsRate={portfolio.usdIlsRate ?? 0}
        updatedAt={portfolio.updatedAt}
      />

      <div className="px-4 pt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setAddPositionOpen(true)}
            className="py-2.5 rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-accent-blue)] font-medium hover:bg-[var(--color-bg-muted)] transition-colors"
          >
            {t("addPosition", language)}
          </button>
          <button
            onClick={() => setAccountManagerOpen(true)}
            className="py-2.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-fg-default)] font-medium hover:bg-[var(--color-bg-muted)] transition-colors"
          >
            Manage Accounts
          </button>
        </div>
      </div>

      <div className="px-4 pt-2 pb-6 space-y-3">
        {accountSummaries.map((account) => {
          const expanded = expandedAccounts[account.name] ?? false;
          return (
            <Card key={account.name} className="overflow-hidden">
              <button
                onClick={() => toggleAccount(account.name)}
                className="w-full text-left px-4 py-4 border-b border-[var(--color-border)] bg-[linear-gradient(135deg,rgba(88,166,255,0.12),transparent_60%)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-[var(--color-fg-default)]">{account.name}</p>
                    <p className="text-xs text-[var(--color-fg-subtle)]">
                      {account.positions.length} positions · {formatILS(account.totalILS)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden sm:grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-[var(--color-bg-subtle)]/70 px-3 py-2 min-w-[92px]">
                        <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-wider">Value</p>
                        <p className="text-sm font-semibold text-[var(--color-fg-default)]">{formatILS(account.totalILS)}</p>
                      </div>
                      <div className="rounded-xl bg-[var(--color-bg-subtle)]/70 px-3 py-2 min-w-[92px]">
                        <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-wider">P/L</p>
                        <p className={`text-sm font-semibold ${account.totalPlILS >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
                          {formatILS(account.totalPlILS)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-[var(--color-bg-subtle)]/70 px-3 py-2 min-w-[92px]">
                        <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-wider">P/L %</p>
                        <p className={`text-sm font-semibold ${account.totalPlPct >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
                          {account.totalPlPct.toFixed(2)}%
                        </p>
                      </div>
                    </div>
                    {expanded ? <ChevronUp size={18} className="text-[var(--color-fg-muted)]" /> : <ChevronDown size={18} className="text-[var(--color-fg-muted)]" />}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 sm:hidden">
                  <div className="rounded-xl bg-[var(--color-bg-subtle)]/70 px-3 py-2">
                    <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-wider">Value</p>
                    <p className="text-sm font-semibold text-[var(--color-fg-default)]">{formatILS(account.totalILS)}</p>
                  </div>
                  <div className="rounded-xl bg-[var(--color-bg-subtle)]/70 px-3 py-2">
                    <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-wider">P/L</p>
                    <p className={`text-sm font-semibold ${account.totalPlILS >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
                      {formatILS(account.totalPlILS)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[var(--color-bg-subtle)]/70 px-3 py-2">
                    <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-wider">P/L %</p>
                    <p className={`text-sm font-semibold ${account.totalPlPct >= 0 ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
                      {account.totalPlPct.toFixed(2)}%
                    </p>
                  </div>
                </div>
              </button>

              {expanded && (
                account.positions.length === 0 ? (
                  <div className="px-4 py-5 text-sm text-[var(--color-fg-subtle)]">
                    Empty account. Add positions from the main action above or remove the account.
                  </div>
                ) : (
                  <>
                    <div className="md:hidden px-3 py-3 space-y-2">
                      {account.positions.map((position) => (
                        <PositionRow
                          key={`${account.name}:${position.ticker}`}
                          position={position}
                          verdict={verdictMap[position.ticker]}
                          hasAlert={alertTickers.has(position.ticker)}
                          isChecking={activeTickerChecks.has(position.ticker)}
                          jobType={tickerJobType.get(position.ticker)}
                          onQuickCheck={() => handleQuickCheck(position.ticker)}
                          onClick={() => handlePositionClick(position)}
                        />
                      ))}
                    </div>

                    <div className="hidden md:block">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[var(--color-border)]">
                            {[t("colTicker", language), t("colShares", language), t("colAvgPrice", language), t("colLivePrice", language), t("colValue", language), t("colPlPct", language), t("colPl", language), t("colWeight", language), t("colVerdict", language)].map((header) => (
                              <th key={`${account.name}:${header}`} className="px-3 py-2 text-left text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {account.positions.map((position) => (
                            <PositionRow
                              key={`${account.name}:${position.ticker}`}
                              position={position}
                              verdict={verdictMap[position.ticker]}
                              hasAlert={alertTickers.has(position.ticker)}
                              isChecking={activeTickerChecks.has(position.ticker)}
                              jobType={tickerJobType.get(position.ticker)}
                              onClick={() => handlePositionClick(position)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              )}
            </Card>
          );
        })}

        <div>
          <button
            onClick={() => setCombinedHoldingsOpen((current) => !current)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-bg-muted)] px-3 py-2 text-xs font-medium text-[var(--color-fg-muted)]"
          >
            <Layers3 size={14} />
            {combinedHoldingsOpen ? "Hide Combined Holdings" : "Show Combined Holdings"}
          </button>
        </div>

        {combinedHoldingsOpen && (
          <Card className="overflow-hidden">
            <div className="px-4 py-4 border-b border-[var(--color-border)] bg-[linear-gradient(135deg,rgba(148,163,184,0.14),transparent_60%)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-[var(--color-fg-default)]">Combined Holdings</p>
                  <p className="text-xs text-[var(--color-fg-subtle)]">
                    Aggregated view across all accounts
                  </p>
                </div>
                <button
                  onClick={() => setCombinedHoldingsOpen(false)}
                  className="text-xs text-[var(--color-fg-muted)]"
                >
                  Hide
                </button>
              </div>
            </div>

            <div className="md:hidden px-3 py-3 space-y-2">
              {portfolio.positions.map((position) => (
                <PositionRow
                  key={position.ticker}
                  position={position}
                  verdict={verdictMap[position.ticker]}
                  hasAlert={alertTickers.has(position.ticker)}
                  isChecking={activeTickerChecks.has(position.ticker)}
                  jobType={tickerJobType.get(position.ticker)}
                  onQuickCheck={() => handleQuickCheck(position.ticker)}
                  onClick={() => handlePositionClick(position)}
                />
              ))}
            </div>

            <div className="hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    {[t("colTicker", language), t("colShares", language), t("colAvgPrice", language), t("colLivePrice", language), t("colValue", language), t("colPlPct", language), t("colPl", language), t("colWeight", language), t("colVerdict", language)].map((header) => (
                      <th key={header} className="px-3 py-2 text-left text-[10px] font-medium text-[var(--color-fg-subtle)] uppercase">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {portfolio.positions.map((position) => (
                    <PositionRow
                      key={position.ticker}
                      position={position}
                      verdict={verdictMap[position.ticker]}
                      hasAlert={alertTickers.has(position.ticker)}
                      isChecking={activeTickerChecks.has(position.ticker)}
                      jobType={tickerJobType.get(position.ticker)}
                      onClick={() => handlePositionClick(position)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <PositionDetailModal
        position={selectedPosition}
        verdict={selectedPosition ? verdictMap[selectedPosition.ticker] : undefined}
        onClose={() => {
          setSelectedPosition(null);
          refetch();
        }}
        onDeletePosition={handleDeleteSelectedPosition}
      />

      <AddPositionModal
        open={addPositionOpen}
        onClose={() => {
          setAddPositionOpen(false);
        }}
        onEditExisting={(ticker) => {
          setAddPositionOpen(false);
          setEditingTicker(ticker);
        }}
      />

      <AccountManagerModal
        open={accountManagerOpen}
        accounts={accountSummaries}
        onClose={() => setAccountManagerOpen(false)}
        onCreate={handleCreateAccount}
        onDelete={handleDeleteAccount}
      />
    </>
  );
}
