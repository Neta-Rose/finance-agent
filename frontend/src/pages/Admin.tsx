import { useState, useEffect, useCallback } from "react";
import {
  adminFetchUsers,
  adminCreateUser,
  adminDeleteUser,
  adminUpdateLimits,
  adminAddTelegram,
  adminGetStatus,
  adminFetchProfiles,
  adminCreateProfile,
  adminUpdateProfile,
  adminDeleteProfile,
  adminSetUserProfile,
  type UserSummary,
  type RateLimits,
  type AdminStatus,
  type ProfileDefinition,
  type ProfilesRegistry,
} from "../api/admin";
import { usePreferencesStore } from "../store/preferencesStore";
import { t } from "../store/i18n";

// ---- Login ----
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const language = usePreferencesStore((s) => s.language);
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
      setError(t("adminLoginError", language));
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🦞</div>
          <h1 className="text-xl font-bold text-[var(--color-fg-default)]">{t("adminTitle", language)}</h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">{t("adminLoginSub", language)}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("adminKeyPlaceholder", language)}
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
          />
          {error && <p className="text-[var(--color-accent-red)] text-sm text-center">{error}</p>}
          <button type="submit" className="w-full py-3 rounded-lg bg-[var(--color-accent-blue)] text-white font-semibold text-sm">
            {t("adminSignIn", language)}
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
  const language = usePreferencesStore((s) => s.language);
  const [draft, setDraft] = useState<RateLimits>({ ...limits });

  const update = (key: keyof RateLimits, field: "maxPerPeriod" | "periodHours", val: number) => {
    setDraft((d) => ({
      ...d,
      [key]: { ...d[key], [field]: val },
    }));
  };

  const rows: Array<{ key: keyof RateLimits; label: string }> = [
    { key: "full_report", label: t("fullReport", language) },
    { key: "daily_brief", label: t("dailyBriefLimit", language) },
    { key: "deep_dive", label: t("deepDiveLimit", language) },
    { key: "new_ideas", label: t("newIdeasLimit", language) },
  ];

  return (
    <div className="space-y-3">
      {rows.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-24 text-[var(--color-fg-muted)] shrink-0">{label}</span>
          <span className="text-[var(--color-fg-subtle)]">{t("adminMax", language)}</span>
          <input
            type="number"
            value={draft[key].maxPerPeriod}
            min={1}
            onChange={(e) => update(key, "maxPerPeriod", Number(e.target.value))}
            className="w-16 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-center text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
          />
          <span className="text-[var(--color-fg-subtle)]">{t("adminPer", language)}</span>
          <input
            type="number"
            value={draft[key].periodHours}
            min={1}
            onChange={(e) => update(key, "periodHours", Number(e.target.value))}
            className="w-16 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-center text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
          />
          <span className="text-[var(--color-fg-subtle)]">{t("adminHrs", language)}</span>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-fg-muted)]">
          {t("cancel", language)}
        </button>
        <button onClick={() => onSave(draft)} className="flex-1 py-2 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold">
          {t("save", language)}
        </button>
      </div>
    </div>
  );
}

// ---- Add User Modal ----
function AddUserModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const language = usePreferencesStore((s) => s.language);
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
    if (!form.userId.trim() || !form.password) { setError(t("adminUserCreationError", language)); return; }
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
      setError(err instanceof Error ? err.message : t("adminUserCreationFailed", language));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]";
  const labelCls = "text-xs text-[var(--color-fg-muted)] block mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full bg-[var(--color-bg-subtle)] md:rounded-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--color-bg-subtle)] border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">{t("adminAddUser", language)}</h2>
          <button onClick={onClose} className="text-[var(--color-fg-muted)] text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <p className="text-[var(--color-accent-red)] text-xs">{error}</p>}

          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t("adminUserIdLabel", language)} *</label>
              <input type="text" value={form.userId} onChange={set("userId")} placeholder="john-doe" maxLength={32} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("adminPasswordLabel", language)} *</label>
              <input type="password" value={form.password} onChange={set("password")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("adminDisplayNameLabel", language)}</label>
              <input type="text" value={form.displayName} onChange={set("displayName")} className={inputCls} />
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase mb-2">{t("adminTelegramSection", language)}</p>
            <div className="space-y-2">
              <div>
                <label className={labelCls}>{t("chatId", language)}</label>
                <input type="text" value={form.telegramChatId} onChange={set("telegramChatId")} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("botToken", language)}</label>
                <input type="text" value={form.botToken} onChange={set("botToken")} className={inputCls} />
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase mb-2">{t("adminScheduleSection", language)}</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>{t("adminDailyTime", language)}</label>
                <input type="time" value={form.dailyBriefTime} onChange={set("dailyBriefTime")}
                  className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-fg-default)] outline-none w-full" />
              </div>
              <div>
                <label className={labelCls}>{t("adminWeeklyDay", language)}</label>
                <select value={form.weeklyResearchDay} onChange={set("weeklyResearchDay")}
                  className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-fg-default)] outline-none w-full">
                  {["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t("adminWeeklyTime", language)}</label>
                <input type="time" value={form.weeklyResearchTime} onChange={set("weeklyResearchTime")}
                  className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--color-fg-default)] outline-none w-full" />
              </div>
            </div>
            <div className="mt-2">
              <label className={labelCls}>{t("timezone", language)}</label>
              <select value={form.timezone} onChange={set("timezone")}
                className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--color-fg-default)] outline-none w-full">
                {["Asia/Jerusalem","America/New_York","America/Los_Angeles","America/Chicago","Europe/London","Europe/Paris","Asia/Tokyo","Asia/Singapore","Australia/Sydney"].map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold text-[var(--color-fg-subtle)] uppercase mb-2">{t("adminRateLimitsSection", language)}</p>
            <div className="space-y-1.5 text-xs">
              {[
                { key: "full_report", label: t("fullReport", language), maxKey: "full_report_max", periodKey: "full_report_period" },
                { key: "daily_brief", label: t("dailyBriefLimit", language), maxKey: "daily_brief_max", periodKey: "daily_brief_period" },
                { key: "deep_dive", label: t("deepDiveLimit", language), maxKey: "deep_dive_max", periodKey: "deep_dive_period" },
                { key: "new_ideas", label: t("newIdeasLimit", language), maxKey: "new_ideas_max", periodKey: "new_ideas_period" },
              ].map(({ key, label, maxKey, periodKey }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-24 text-[var(--color-fg-muted)]">{label}</span>
                  <span className="text-[var(--color-fg-subtle)]">{t("adminMax", language)}</span>
                  <input type="number" value={(form as Record<string,string>)[maxKey]} min={1}
                    onChange={set(maxKey as keyof typeof form)}
                    className="w-14 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-center text-[var(--color-fg-default)] outline-none" />
                  <span className="text-[var(--color-fg-subtle)]">{t("adminPer", language)}</span>
                  <input type="number" value={(form as Record<string,string>)[periodKey]} min={1}
                    onChange={set(periodKey as keyof typeof form)}
                    className="w-14 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-center text-[var(--color-fg-default)] outline-none" />
                  <span className="text-[var(--color-fg-subtle)]">{t("adminHrs", language)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-fg-muted)]">
              {t("cancel", language)}
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold disabled:opacity-50">
              {loading ? t("adminCreating", language) : t("adminCreateUser", language)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Profile Editor ----
function ProfileEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ProfileDefinition;
  onSave: (def: ProfileDefinition) => void;
  onCancel: () => void;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [draft, setDraft] = useState<ProfileDefinition>({ ...initial });
  const fields: Array<{ key: keyof ProfileDefinition; labelKey: "adminOrchestrator" | "adminAnalysts" | "adminRisk" | "adminResearchers" }> = [
    { key: "orchestrator", labelKey: "adminOrchestrator" },
    { key: "analysts", labelKey: "adminAnalysts" },
    { key: "risk", labelKey: "adminRisk" },
    { key: "researchers", labelKey: "adminResearchers" },
  ];
  return (
    <div className="space-y-2 pt-1">
      {fields.map(({ key, labelKey }) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-[var(--color-fg-muted)]">{t(labelKey, language)}</span>
          <input
            value={draft[key]}
            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            className="flex-1 bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
            placeholder={`model id`}
          />
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 py-1.5 rounded border border-[var(--color-border)] text-xs text-[var(--color-fg-muted)]">{t("cancel", language)}</button>
        <button onClick={() => onSave(draft)} className="flex-1 py-1.5 rounded bg-[var(--color-accent-blue)] text-white text-xs font-semibold">{t("save", language)}</button>
      </div>
    </div>
  );
}

// ---- Profiles Section ----
function ProfilesSection({ onError }: { onError: (msg: string) => void }) {
  const language = usePreferencesStore((s) => s.language);
  const [profiles, setProfiles] = useState<ProfilesRegistry>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDef, setNewDef] = useState<ProfileDefinition>({ orchestrator: "", analysts: "", risk: "", researchers: "" });

  const load = useCallback(async () => {
    try {
      const { profiles: p } = await adminFetchProfiles();
      setProfiles(p);
    } catch (e) {
      onError(e instanceof Error ? e.message : t("adminFailedLoadProfiles", language));
    }
  }, [onError, language]);

  useEffect(() => { void load(); }, [load]);

  const handleUpdate = async (name: string, def: ProfileDefinition) => {
    try {
      await adminUpdateProfile(name, def);
      setEditing(null);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("adminFailedUpdateProfile", language));
    }
  };

  const handleCreate = async (def: ProfileDefinition) => {
    try {
      await adminCreateProfile(newName.trim(), def);
      setAdding(false);
      setNewName("");
      setNewDef({ orchestrator: "", analysts: "", risk: "", researchers: "" });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("adminFailedCreateProfile", language));
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`${t("adminConfirmDeleteProfile", language)} "${name}"?`)) return;
    try {
      await adminDeleteProfile(name);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("adminFailedDeleteProfile", language));
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-[var(--color-fg-default)]">{t("adminModelProfiles", language)}</h2>
        <button
          onClick={() => setAdding(true)}
          className="text-xs px-3 py-1 rounded-lg bg-[var(--color-accent-blue)] text-white font-semibold"
        >{t("adminAddProfile", language)}</button>
      </div>
      <div className="space-y-2">
        {Object.entries(profiles).map(([name, def]) => (
          <div key={name} className="bg-[var(--color-bg-subtle)] rounded-xl px-4 py-3 border border-[var(--color-border)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-fg-default)]">{name}</span>
              <div className="flex gap-3">
                <button onClick={() => setEditing(editing === name ? null : name)}
                  className="text-xs text-[var(--color-accent-blue)]">
                  {editing === name ? t("cancel", language) : t("edit", language)}
                </button>
                <button onClick={() => handleDelete(name)}
                  className="text-xs text-[var(--color-accent-red)]">{t("delete", language)}</button>
              </div>
            </div>
            {editing !== name && (
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                {(["orchestrator", "analysts", "risk", "researchers"] as const).map((k) => (
                  <span key={k} className="text-xs text-[var(--color-fg-muted)]">
                    <span className="text-[var(--color-fg-subtle)]">{k}: </span>{def[k]}
                  </span>
                ))}
              </div>
            )}
            {editing === name && (
              <div className="mt-2">
                <ProfileEditor initial={def} onSave={(d) => handleUpdate(name, d)} onCancel={() => setEditing(null)} />
              </div>
            )}
          </div>
        ))}
        {adding && (
          <div className="bg-[var(--color-bg-subtle)] rounded-xl px-4 py-3 border border-[var(--color-accent-blue)]">
            <div className="mb-2">
              <label className="text-xs text-[var(--color-fg-muted)] block mb-1">{t("adminProfileName", language)}</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("adminProfileNameHint", language)}
                className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]"
              />
            </div>
            <ProfileEditor
              initial={newDef}
              onSave={(d) => handleCreate(d)}
              onCancel={() => { setAdding(false); setNewName(""); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Profile Badge ----
function ProfileBadge({
  userId,
  current,
  profiles,
  onChanged,
  onError,
}: {
  userId: string;
  current: string;
  profiles: ProfilesRegistry;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [open, setOpen] = useState(false);
  const colorMap: Record<string, string> = {
    testing: "bg-blue-500/20 text-blue-400",
    production: "bg-green-500/20 text-green-400",
    free: "bg-gray-500/20 text-gray-400",
  };
  const colorClass = colorMap[current] ?? "bg-purple-500/20 text-purple-400";

  const handleSwitch = async (name: string) => {
    setOpen(false);
    try {
      await adminSetUserProfile(userId, name);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("adminFailedSwitchProfile", language));
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colorClass}`}
      >
        {current} ▾
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-20 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[120px]">
          {Object.keys(profiles).map((name) => (
            <button
              key={name}
              onClick={() => handleSwitch(name)}
              className={`w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--color-bg-muted)] ${name === current ? "font-bold text-[var(--color-accent-blue)]" : "text-[var(--color-fg-default)]"}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Health Badge ----
function HealthBadge({ health }: { health: UserSummary["agentHealth"] }) {
  const language = usePreferencesStore((s) => s.language);
  if (health.healthy) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium">{t("adminStatusOk", language)}</span>;
  }
  const tooltip = health.lastErrorReason
    ? `${health.lastErrorReason} (${health.consecutiveErrors} errors)`
    : health.lastError
    ? health.lastError.slice(0, 160)
    : `${health.consecutiveErrors} consecutive errors`;
  return (
    <span
      title={tooltip}
      className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium cursor-help"
    >
      {t("adminStatusError", language)}
    </span>
  );
}

// ---- User Card ----
function UserCard({
  user,
  profiles,
  onDelete,
  onUpdateLimits,
  onAddTelegram,
  onProfileChanged,
  onError,
}: {
  user: UserSummary;
  profiles: ProfilesRegistry;
  onDelete: (userId: string) => void;
  onUpdateLimits: (userId: string, limits: Partial<RateLimits>) => void;
  onAddTelegram: (userId: string, botToken: string, chatId: string) => void;
  onProfileChanged: () => void;
  onError: (msg: string) => void;
}) {
  const language = usePreferencesStore((s) => s.language);
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

  const stateLabel = user.state === "ACTIVE" ? t("adminStateActive", language)
    : user.state === "BOOTSTRAPPING" ? t("adminStateBootstrapping", language)
    : user.state;
  const portfolioLabel = user.portfolioLoaded ? t("adminPortfolioLoaded", language) : t("adminPortfolioMissing", language);

  return (
    <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[var(--color-fg-default)]">{user.displayName}</span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">@{user.userId}</span>
          </div>
          <p className={`text-[10px] font-medium uppercase mt-0.5 ${stateColor}`}>
            {stateLabel} · {portfolioLabel}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ProfileBadge
            userId={user.userId}
            current={user.modelProfile}
            profiles={profiles}
            onChanged={onProfileChanged}
            onError={onError}
          />
          <HealthBadge health={user.agentHealth} />
        </div>
      </div>

      <div className="text-[11px] text-[var(--color-fg-muted)] space-y-0.5 mb-3">
        {user.hasTelegram ? (
          <p>{t("adminTelegramYes", language)}{user.telegramChatId ? ` (${user.telegramChatId})` : ""}</p>
        ) : (
          <p>{t("adminTelegramNo", language)}</p>
        )}
        <p>{t("adminDeepDives", language)} {user.rateLimits.deep_dive.maxPerPeriod}/{t("perDay", language).replace("/ ", "")} · {t("adminFullReportsLabel", language)} {user.rateLimits.full_report.maxPerPeriod}/{t("perWeek", language).replace("/ ", "")}</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {user.hasTelegram ? (
          <button onClick={() => setShowTelegram(!showTelegram)}
            className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-fg-muted)]">
            {t("adminEditTelegram", language)}
          </button>
        ) : (
          <button onClick={() => setShowTelegram(!showTelegram)}
            className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-accent-blue)]">
            {t("adminAddTelegram", language)}
          </button>
        )}
        <button onClick={() => setShowLimits(!showLimits)}
          className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-medium text-[var(--color-fg-muted)]">
          {t("adminEditLimits", language)}
        </button>
        <button onClick={() => setShowDelete(true)}
          className="px-3 py-1.5 rounded-lg border border-[var(--color-accent-red)]/40 text-[10px] font-medium text-[var(--color-accent-red)]">
          {t("delete", language)}
        </button>
      </div>

      {/* Edit Telegram */}
      {showTelegram && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
          <input type="text" placeholder={t("botToken", language)} value={botToken} onChange={(e) => setBotToken(e.target.value)}
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
          <input type="text" placeholder={t("chatId", language)} value={chatId} onChange={(e) => setChatId(e.target.value)}
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)]" />
          <button onClick={() => { onAddTelegram(user.userId, botToken, chatId); setShowTelegram(false); setBotToken(""); }}
            className="w-full py-1.5 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold">
            {t("adminSaveTelegram", language)}
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
            {t("adminTypeToConfirm", language)} <strong>{user.userId}</strong> {t("adminToConfirmDeletion", language)}
          </p>
          <input type="text" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={user.userId}
            className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-accent-red)]/40 rounded-lg px-3 py-1.5 text-xs text-[var(--color-fg-default)] outline-none" />
          <button onClick={handleDelete} disabled={deleteConfirm !== user.userId || deleting}
            className="w-full py-1.5 rounded-lg bg-[var(--color-accent-red)] text-white text-xs font-semibold disabled:opacity-40">
            {deleting ? t("adminDeleting", language) : t("adminConfirmDelete", language)}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Main Admin Page ----
export function Admin() {
  const language = usePreferencesStore((s) => s.language);
  const isLoggedIn = !!sessionStorage.getItem("admin_key");
  const [loggedIn, setLoggedIn] = useState(isLoggedIn);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [profiles, setProfiles] = useState<ProfilesRegistry>({});
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, { users: u }, { profiles: p }] = await Promise.all([
        adminGetStatus(),
        adminFetchUsers(),
        adminFetchProfiles(),
      ]);
      setStatus(s);
      setUsers(u);
      setProfiles(p);
    } catch {
      // handled by login
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
          <span className="font-bold text-sm text-[var(--color-fg-default)]">{t("adminTitle", language)}</span>
          <span className="text-xs text-[var(--color-fg-subtle)]">{t("adminLoginSub", language)}</span>
        </div>
        <button onClick={() => { sessionStorage.removeItem("admin_key"); setLoggedIn(false); }}
          className="text-[10px] text-[var(--color-fg-muted)] border border-[var(--color-border)] rounded px-2 py-1">
          {t("logout", language)}
        </button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Status bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-center">
            <p className="text-xs text-[var(--color-fg-subtle)]">{t("adminGateway", language)}</p>
            <p className={`text-sm font-bold mt-0.5 ${status?.gatewayRunning ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
              {status?.gatewayRunning ? t("adminRunning", language) : t("adminStopped", language)}
            </p>
          </div>
          <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-center">
            <p className="text-xs text-[var(--color-fg-subtle)]">{t("adminUsers", language)}</p>
            <p className="text-sm font-bold text-[var(--color-fg-default)] mt-0.5">
              {users.length} {t("adminTotal", language)}
            </p>
          </div>
          <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-center">
            <p className="text-xs text-[var(--color-fg-subtle)]">{t("adminActive", language)}</p>
            <p className="text-sm font-bold text-[var(--color-accent-green)] mt-0.5">
              {status?.activeAgents ?? 0}
            </p>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-[var(--color-accent-red)] flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Model Profiles */}
        <ProfilesSection onError={setError} />

        {/* Add user */}
        <button onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold">
          + {t("adminAddUser", language)}
        </button>

        {/* User cards */}
        {loading && users.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-fg-muted)] text-sm">{t("loading", language)}</div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-fg-muted)] text-sm">{t("adminNoUsers", language)}</div>
        ) : (
          <div className="space-y-3">
            {users.map((user) => (
              <UserCard
                key={user.userId}
                user={user}
                profiles={profiles}
                onDelete={handleDelete}
                onUpdateLimits={handleUpdateLimits}
                onAddTelegram={handleAddTelegram}
                onProfileChanged={load}
                onError={setError}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  );
}
