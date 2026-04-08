import { useState, useEffect, useCallback } from "react";
import {
  adminFetchUsers,
  adminCreateUser,
  adminDeleteUser,
  adminUpdateLimits,
  adminAddTelegram,
  adminGetStatus,
  type UserSummary,
  type RateLimits,
  type AdminStatus,
} from "../api/admin";

// ---- Login ----
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    sessionStorage.setItem("admin_key", key.trim());
    try {
      await adminGetStatus();
      onLogin();
    } catch {
      sessionStorage.removeItem("admin_key");
      setError("Invalid admin key");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🦞</div>
          <h1 className="text-xl font-bold text-[var(--color-fg-default)]">Admin Panel</h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">rebalancer.shop</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Admin Key"
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
          />
          {error && <p className="text-[var(--color-accent-red)] text-sm text-center">{error}</p>}
          <button type="submit" className="w-full py-3 rounded-lg bg-[var(--color-accent-blue)] text-white font-semibold text-sm">
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

// ---- Rate Limits Editor ----
function RateLimitsEditor({
  limits,
  onSave,
  onCancel,
}: {
  limits: RateLimits;
  onSave: (l: RateLimits) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RateLimits>({ ...limits });

  const update = (key: keyof RateLimits, field: "maxPerPeriod" | "periodHours", val: number) => {
    setDraft((d) => ({
      ...d,
      [key]: { ...d[key], [field]: val },
    }));
  };

  const rows: Array<{ key: keyof RateLimits; label: string }> = [
    { key: "full_report", label: "Full report" },
    { key: "daily_brief", label: "Daily brief" },
    { key: "deep_dive", label: "Deep dive" },
    { key: "new_ideas", label: "New ideas" },
  ];

  return (
    <div className="space-y-3">
      {rows.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-24 text-[var(--color-fg-muted)] shrink-0">{label}</span>
          <span className="text-[var(--color-fg-subtle)]">max</span>
          <input
            type="number"
            value={draft[key].maxPerPeriod}
            min={1}
            onChange={(e) => update(key, "maxPerPeriod", Number(e.target.value))}
            className="w-16 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-center text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
          />
          <span className="text-[var(--color-fg-subtle)]">per</span>
          <input
            type="number"
            value={draft[key].periodHours}
            min={1}
            onChange={(e) => update(key, "periodHours", Number(e.target.value))}
            className="w-16 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-center text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
          />
          <span className="text-[var(--color-fg-subtle)]">hrs</span>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-fg-muted)]">
          Cancel
        </button>
        <button onClick={() => onSave(draft)} className="flex-1 py-2 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold">
          Save
        </button>
      </div>
    </div>
  );
}

// ---- Add User Modal ----
function AddUserModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    userId: "",
    password: "",
    displayName: "",
    telegramChatId: "",
    botToken: "",
    dailyBriefTime: "08:00",
    weeklyResearchDay: "sunday",
    weeklyResearchTime: "19:00",
    timezone: "Asia/Jerusalem",
    full_report_max: "1",
    full_report_period: "168",
    daily_brief_max: "3",
    daily_brief_period: "24",
    deep_dive_max: "5",
    deep_dive_period: "24",
    new_ideas_max: "2",
    new_ideas_period: "168",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.userId.trim() || !form.password) { setError("User ID and password required"); return; }
    setLoading(true);
    setError("");
    try {
      await adminCreateUser({
        userId: form.userId.trim(),
        password: form.password,
        displayName: form.displayName.trim() || form.userId.trim(),
        telegramChatId: form.telegramChatId || undefined,
        telegramBotToken: form.botToken || undefined,
        schedule: {
          dailyBriefTime: form.dailyBriefTime,
          weeklyResearchDay: form.weeklyResearchDay,
          weeklyResearchTime: form.weeklyResearchTime,
          timezone: form.timezone,
        },
        rateLimits: {
          full_report: { maxPerPeriod: Number(form.full_report_max), periodHours: Number(form.full_report_period) },
          daily_brief: { maxPerPeriod: Number(form.daily_brief_max), periodHours: Number(form.daily_brief_period) },
          deep_dive: { maxPerPeriod: Number(form.deep_dive_max), periodHours: Number(form.deep_dive_period) },
          new_ideas: { maxPerPeriod: Number(form.new_ideas_max), periodHours: Number(form.new_ideas_period) },
        },
      });
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full bg-[var(--color-bg-subtle)] md:rounded-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--color-bg-subtle)] border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">Add User</h2>
          <button onClick={onClose} className="text-[var(--color-fg-muted)] text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <p className="text-[var(--color-accent-red)] text-xs">{error}</p>}

          <div className="space-y-3">
            <div><label className="text-xs text-[var(--color-fg-muted)] block mb-1">User ID *</label>
              <input type="text" value={form.userId} onChange={set("userId")}
                placeholder="john-doe" maxLength={32}
                className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
            </div>
            <div><label className="text-xs text-[var(--color-fg-muted)] block mb-1">Password *</label>
              <input type="password" value={form.password} onChange={set("password")}
                className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
            </div>
            <div><label className="text-xs text-[var(--color-fg-muted)] block mb-1">Display Name</label>
              <input type="text" value={form.displayName} onChange={set("displayName")}
                className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase mb-2">Telegram (optional)</p>
            <div className="space-y-2">
              <div><label className="text-xs text-[var(--color-fg-muted)] block mb-1">Chat ID</label>
                <input type="text" value={form.telegramChatId} onChange={set("telegramChatId")}
                  className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
              </div>
              <div><label className="text-xs text-[var(--color-fg-muted)] block mb-1">Bot Token (from BotFather)</label>
                <input type="text" value={form.botToken} onChange={set("botToken")}
                  className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase mb-2">Schedule</p>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-xs text-[var(--color-fg-muted)] block mb-1">Daily time</label>
                <input type="time" value={form.dailyBriefTime} onChange={set("dailyBriefTime")}
                  className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-fg-default)] outline-none w-full" />
              </div>
              <div><label className="text-xs text-[var(--color-fg-muted)] block mb-1">Weekly day</label>
                <select value={form.weeklyResearchDay} onChange={set("weeklyResearchDay")}
                  className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-fg-default)] outline-none w-full">
                  {["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-[var(--color-fg-muted)] block mb-1">Weekly time</label>
                <input type="time" value={form.weeklyResearchTime} onChange={set("weeklyResearchTime")}
                  className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-fg-default)] outline-none w-full" />
              </div>
            </div>
            <div className="mt-2">
              <label className="text-xs text-[var(--color-fg-muted)] block mb-1">Timezone</label>
              <select value={form.timezone} onChange={set("timezone")}
                className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--color-fg-default)] outline-none w-full">
                {["Asia/Jerusalem","America/New_York","America/Los_Angeles","America/Chicago","Europe/London","Europe/Paris","Asia/Tokyo","Asia/Singapore","Australia/Sydney"].map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase mb-2">Rate Limits</p>
            <div className="space-y-1.5 text-xs">
              {[
                { key: "full_report", label: "Full report", maxKey: "full_report_max", periodKey: "full_report_period" },
                { key: "daily_brief", label: "Daily brief", maxKey: "daily_brief_max", periodKey: "daily_brief_period" },
                { key: "deep_dive", label: "Deep dive", maxKey: "deep_dive_max", periodKey: "deep_dive_period" },
                { key: "new_ideas", label: "New ideas", maxKey: "new_ideas_max", periodKey: "new_ideas_period" },
              ].map(({ key, label, maxKey, periodKey }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-24 text-[var(--color-fg-muted)]">{label}</span>
                  <span className="text-[var(--color-fg-subtle)]">max</span>
                  <input type="number" value={(form as Record<string,string>)[maxKey]} min={1}
                    onChange={set(maxKey as keyof typeof form)}
                    className="w-14 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-center text-[var(--color-fg-default)] outline-none" />
                  <span className="text-[var(--color-fg-subtle)]">per</span>
                  <input type="number" value={(form as Record<string,string>)[periodKey]} min={1}
                    onChange={set(periodKey as keyof typeof form)}
                    className="w-14 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-center text-[var(--color-fg-default)] outline-none" />
                  <span className="text-[var(--color-fg-subtle)]">hrs</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-fg-muted)]">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold disabled:opacity-50">
              {loading ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- User Card ----
function UserCard({
  user,
  onDelete,
  onUpdateLimits,
  onAddTelegram,
}: {
  user: UserSummary;
  onDelete: (userId: string) => void;
  onUpdateLimits: (userId: string, limits: Partial<RateLimits>) => void;
  onAddTelegram: (userId: string, botToken: string, chatId: string) => void;
}) {
  const [showLimits, setShowLimits] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState(user.telegramChatId ?? "");
  const [showTelegram, setShowTelegram] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const stateColor =
    user.state === "ACTIVE" ? "text-[var(--color-accent-green)]" :
    user.state === "BOOTSTRAPPING" ? "text-[var(--color-accent-yellow)]" :
    "text-[var(--color-fg-muted)]";

  const handleDelete = async () => {
    if (deleteConfirm !== user.userId) return;
    setDeleting(true);
    try {
      await onDelete(user.userId);
    } finally {
      setDeleting(false);
      setShowDelete(false);
      setDeleteConfirm("");
    }
  };

  const handleSaveLimits = (l: RateLimits) => {
    onUpdateLimits(user.userId, l);
    setShowLimits(false);
  };

  return (
    <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[var(--color-fg-default)]">{user.displayName}</span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">@{user.userId}</span>
          </div>
          <p className={`text-[10px] font-medium uppercase mt-0.5 ${stateColor}`}>
            {user.state}
            {user.portfolioLoaded ? " · portfolio ✓" : " · portfolio ✗"}
          </p>
        </div>
      </div>

      <div className="text-[11px] text-[var(--color-fg-muted)] space-y-0.5 mb-3">
        {user.hasTelegram ? (
          <p>🔔 Telegram: ✅ connected{user.telegramChatId ? ` (${user.telegramChatId})` : ""}</p>
        ) : (
          <p>🔔 Telegram: ✗ not connected</p>
        )}
        <p>📊 Deep dives: {user.rateLimits.deep_dive.maxPerPeriod}/day · Full reports: {user.rateLimits.full_report.maxPerPeriod}/week</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {user.hasTelegram ? (
          <button onClick={() => setShowTelegram(!showTelegram)}
            className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-fg-muted)]">
            Edit Telegram
          </button>
        ) : (
          <button onClick={() => setShowTelegram(!showTelegram)}
            className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-accent-blue)]">
            Add Telegram
          </button>
        )}
        <button onClick={() => setShowLimits(!showLimits)}
          className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-fg-muted)]">
          Edit Limits
        </button>
        <button onClick={() => setShowDelete(true)}
          className="px-3 py-1.5 rounded-lg border border-[var(--color-accent-red)]/40 text-[10px] font-medium text-[var(--color-accent-red)]">
          Delete
        </button>
      </div>

      {/* Edit Telegram */}
      {showTelegram && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
          <input type="text" placeholder="Bot Token" value={botToken} onChange={(e) => setBotToken(e.target.value)}
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
          <input type="text" placeholder="Chat ID" value={chatId} onChange={(e) => setChatId(e.target.value)}
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
          <button onClick={() => { onAddTelegram(user.userId, botToken, chatId); setShowTelegram(false); setBotToken(""); }}
            className="w-full py-1.5 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold">
            Save Telegram
          </button>
        </div>
      )}

      {/* Edit Limits */}
      {showLimits && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <RateLimitsEditor limits={user.rateLimits} onSave={handleSaveLimits} onCancel={() => setShowLimits(false)} />
        </div>
      )}

      {/* Delete confirm */}
      {showDelete && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
          <p className="text-[10px] text-[var(--color-accent-red)]">
            Type <strong>{user.userId}</strong> to confirm deletion:
          </p>
          <input type="text" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={user.userId}
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-accent-red)]/40 rounded-lg px-3 py-1.5 text-xs text-[var(--color-fg-default)] outline-none" />
          <button onClick={handleDelete} disabled={deleteConfirm !== user.userId || deleting}
            className="w-full py-1.5 rounded-lg bg-[var(--color-accent-red)] text-white text-xs font-semibold disabled:opacity-40">
            {deleting ? "Deleting..." : "Confirm Delete"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Main Admin Page ----
export function Admin() {
  const isLoggedIn = !!sessionStorage.getItem("admin_key");
  const [loggedIn, setLoggedIn] = useState(isLoggedIn);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([adminGetStatus(), adminFetchUsers()]);
      setStatus(s);
      setUsers(u.users);
    } catch {
      // error handled in login
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  const handleDelete = async (userId: string) => {
    await adminDeleteUser(userId);
    setUsers((prev) => prev.filter((u) => u.userId !== userId));
  };

  const handleUpdateLimits = async (userId: string, limits: Partial<RateLimits>) => {
    await adminUpdateLimits(userId, limits);
    setUsers((prev) => prev.map((u) => u.userId === userId ? { ...u, rateLimits: { ...u.rateLimits, ...limits } } : u));
  };

  const handleAddTelegram = async (userId: string, botToken: string, chatId: string) => {
    await adminAddTelegram(userId, botToken, chatId);
    load();
  };

  if (!loggedIn) return <AdminLogin onLogin={() => setLoggedIn(true)} />;

  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[var(--color-bg-subtle)] border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🦞</span>
          <span className="font-bold text-sm text-[var(--color-fg-default)]">Admin Panel</span>
          <span className="text-xs text-[var(--color-fg-subtle)]">rebalancer.shop</span>
        </div>
        <button onClick={() => { sessionStorage.removeItem("admin_key"); setLoggedIn(false); }}
          className="text-[10px] text-[var(--color-fg-muted)] border border-[var(--color-border)] rounded px-2 py-1">
          Logout
        </button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Status bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-center">
            <p className="text-xs text-[var(--color-fg-subtle)]">Gateway</p>
            <p className={`text-sm font-bold mt-0.5 ${status?.gatewayRunning ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
              {status?.gatewayRunning ? "🟢 running" : "🔴 stopped"}
            </p>
          </div>
          <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-center">
            <p className="text-xs text-[var(--color-fg-subtle)]">Users</p>
            <p className="text-sm font-bold text-[var(--color-fg-default)] mt-0.5">
              {users.length} total
            </p>
          </div>
          <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-center">
            <p className="text-xs text-[var(--color-fg-subtle)]">Active</p>
            <p className="text-sm font-bold text-[var(--color-accent-green)] mt-0.5">
              {status?.activeAgents ?? 0}
            </p>
          </div>
        </div>

        {/* Add user */}
        <button onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold">
          + Add User
        </button>

        {/* User cards */}
        {loading && users.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-fg-muted)] text-sm">Loading...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-fg-muted)] text-sm">No users yet</div>
        ) : (
          <div className="space-y-3">
            {users.map((user) => (
              <UserCard
                key={user.userId}
                user={user}
                onDelete={handleDelete}
                onUpdateLimits={handleUpdateLimits}
                onAddTelegram={handleAddTelegram}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  );
}
