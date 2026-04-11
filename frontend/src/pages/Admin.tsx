import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminFetchUsers,
  adminCreateUser,
  adminDeleteUser,
  adminUpdateLimits,
  adminAddTelegram,
  adminGetStatus,
  adminGetSystemAgent,
  adminFetchProfiles,
  adminCreateProfile,
  adminUpdateProfile,
  adminDeleteProfile,
  adminSetUserProfile,
  adminSetSystemAgentProfile,
  adminGetUserObservability,
  adminSetUserControl,
  adminClearUserControl,
  adminForceLogout,
  adminGetSystem,
  adminPatchSystem,
  adminListJobs,
  adminCreateJob,
  adminEditJob,
  adminCancelJob,
  adminContinueJob,
  adminWakeUser,
  adminKillJob,
  type UserSummary,
  type SystemAgentSummary,
  type RateLimits,
  type AdminStatus,
  type ProfileDefinition,
  type ProfilesRegistry,
  type UserObservability,
  type LlmRequestEvent,
  type UserControlPatch,
  type SystemControlPatch,
  type AdminJob,
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

// ---- User Activity Badge ----
function UserActivityBadge({ userId }: { userId: string }) {
  const [data, setData] = useState<UserObservability | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    adminGetUserObservability(userId)
      .then(setData)
      .catch(() => { /* no data yet — silently ignore */ });
  }, [userId]);

  if (!data || (data.history.length === 0 && data.recent.length === 0)) {
    return (
      <p className="text-[11px] text-[var(--color-fg-subtle)] italic mt-1">
        No LLM activity yet
      </p>
    );
  }

  const today = data.history[0];
  const last = data.recent[0];

  return (
    <div className="mt-1 text-[11px] text-[var(--color-fg-muted)]">
      <div className="flex items-center gap-3 flex-wrap">
        {today && (
          <>
            <span>
              <span className="text-[var(--color-fg-subtle)]">Today: </span>
              <span className="font-medium text-[var(--color-fg-default)]">
                {today.requestCount} req
              </span>
              {" · "}
              <span className="text-[var(--color-accent-green)]">
                ${today.totalCostUsd.toFixed(4)}
              </span>
            </span>
            <span>
              <span className="text-[var(--color-fg-subtle)]">Tokens: </span>
              {((today.totalTokensIn + today.totalTokensOut) / 1000).toFixed(1)}k
            </span>
          </>
        )}
        {last && (
          <span>
            <span className="text-[var(--color-fg-subtle)]">Last: </span>
            <span className="font-mono text-[10px]">{last.analyst}</span>
            {" · "}
            <span className="text-[10px] text-[var(--color-fg-subtle)]">
              {new Date(last.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {" · "}
            <span
              className={
                last.status === "success"
                  ? "text-[var(--color-accent-green)]"
                  : "text-[var(--color-accent-red)]"
              }
            >
              {last.status}
            </span>
          </span>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[var(--color-accent-blue)] underline text-[10px]"
        >
          {expanded ? "hide" : `show ${data.recent.length} recent`}
        </button>
      </div>

      {expanded && data.recent.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="text-[var(--color-fg-subtle)] border-b border-[var(--color-border)]">
                <th className="text-left py-1 pr-2 font-normal">Time</th>
                <th className="text-left pr-2 font-normal">Analyst</th>
                <th className="text-left pr-2 font-normal">Purpose</th>
                <th className="text-left pr-2 font-normal">Model</th>
                <th className="text-right pr-2 font-normal">Tokens</th>
                <th className="text-right pr-2 font-normal">Cost</th>
                <th className="text-left font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r: LlmRequestEvent) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-border)] border-opacity-30 hover:bg-[var(--color-bg-muted)]"
                >
                  <td className="py-0.5 pr-2 text-[var(--color-fg-subtle)] font-mono whitespace-nowrap">
                    {new Date(r.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className="pr-2 font-medium">{r.analyst}</td>
                  <td className="pr-2 text-[var(--color-fg-subtle)]">
                    {r.purpose ?? "—"}
                    {r.ticker ? ` (${r.ticker})` : ""}
                  </td>
                  <td className="pr-2 font-mono text-[9px] text-[var(--color-fg-subtle)]">
                    {r.model.split("/").slice(-1)[0]}
                  </td>
                  <td className="pr-2 text-right">
                    {((r.tokensIn + r.tokensOut) / 1000).toFixed(1)}k
                  </td>
                  <td className="pr-2 text-right text-[var(--color-accent-green)]">
                    ${r.costUsd.toFixed(4)}
                  </td>
                  <td
                    className={
                      r.status === "success"
                        ? "text-[var(--color-accent-green)]"
                        : "text-[var(--color-accent-red)]"
                    }
                  >
                    {r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- System Controls ----
function SystemControls({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: sys, isLoading } = useQuery({
    queryKey: ["admin-system"],
    queryFn: adminGetSystem,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const [lockReason,    setLockReason]    = useState("");
  const [lockedUntil,  setLockedUntil]    = useState("");
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastType, setBroadcastType] = useState<"info" | "warning" | "error">("info");
  const [showBroadcast, setShowBroadcast] = useState(false);

  const patch = async (p: SystemControlPatch) => {
    try {
      await adminPatchSystem(p);
      void qc.invalidateQueries({ queryKey: ["admin-system"] });
    } catch (e) {
      onError(e instanceof Error ? e.message : "System update failed");
    }
  };

  const handleLockToggle = () => {
    if (sys?.locked) {
      void patch({ locked: false });
    } else {
      void patch({ locked: true, lockReason: lockReason || "System locked by admin", lockedUntil: lockedUntil || null });
    }
  };

  const handleBroadcast = () => {
    if (!broadcastText.trim()) return;
    void patch({ broadcast: { text: broadcastText.trim(), type: broadcastType, dismissible: true, expiresAt: null } });
    setBroadcastText(""); setShowBroadcast(false);
  };

  const clearBroadcast = () => void patch({ broadcast: null });
  const isLocked = sys?.locked ?? false;

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{
        background: isLocked ? "rgba(239,68,68,0.05)" : "var(--color-bg-subtle)",
        borderColor: isLocked ? "rgba(239,68,68,0.3)" : "var(--color-border)",
      }}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>
          ⚡ System Controls
        </h3>
        {isLocked && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(239,68,68,0.15)", color: "var(--color-accent-red)" }}>
            LOCKED
          </span>
        )}
      </div>

      <div className="space-y-2">
        {!isLocked && (
          <div className="flex gap-2">
            <input value={lockReason} onChange={e => setLockReason(e.target.value)}
              placeholder="Lock reason (shown to users)"
              className="flex-1 text-xs rounded-lg px-3 py-1.5 outline-none"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
            />
            <input type="datetime-local" value={lockedUntil} onChange={e => setLockedUntil(e.target.value)}
              title="Auto-unlock at (optional)"
              className="text-xs rounded-lg px-2 py-1.5 outline-none w-44"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}
            />
          </div>
        )}
        {isLocked && sys?.lockReason && (
          <p className="text-xs" style={{ color: "var(--color-fg-muted)" }}>
            Reason: <span style={{ color: "var(--color-fg-default)" }}>{sys.lockReason}</span>
            {sys.lockedUntil && <> · until {new Date(sys.lockedUntil).toLocaleString()}</>}
          </p>
        )}
        <button onClick={handleLockToggle} disabled={isLoading}
          className="w-full py-2 rounded-lg text-xs font-semibold transition-colors"
          style={isLocked
            ? { background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "var(--color-accent-green)" }
            : { background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-accent-red)" }}>
          {isLocked ? "🔓 Unlock — Resume Normal Operations" : "🔒 Lock All Users"}
        </button>
      </div>

      <div className="border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        {sys?.broadcast ? (
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[10px] uppercase font-semibold" style={{ color: "var(--color-fg-muted)" }}>Broadcast active</span>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-fg-default)" }}>{sys.broadcast.text}</p>
            </div>
            <button onClick={clearBroadcast}
              className="shrink-0 text-xs px-2 py-1 rounded"
              style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
              Clear
            </button>
          </div>
        ) : showBroadcast ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select value={broadcastType} onChange={e => setBroadcastType(e.target.value as "info" | "warning" | "error")}
                className="text-xs rounded-lg px-2 py-1.5 outline-none"
                style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}>
                <option value="info">ℹ Info</option>
                <option value="warning">⚠ Warning</option>
                <option value="error">⊗ Error</option>
              </select>
              <input value={broadcastText} onChange={e => setBroadcastText(e.target.value)}
                placeholder="Message to show all users..."
                className="flex-1 text-xs rounded-lg px-3 py-1.5 outline-none"
                style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleBroadcast}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: "var(--color-accent-blue)", color: "white" }}>
                Send Broadcast
              </button>
              <button onClick={() => setShowBroadcast(false)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowBroadcast(true)}
            className="w-full py-2 rounded-lg text-xs font-medium"
            style={{ background: "var(--color-bg-muted)", border: "1px dashed var(--color-border)", color: "var(--color-fg-muted)" }}>
            📢 Send Broadcast Message to All Users
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Block Controls ----
const RESTRICTION_LABELS = {
  readonly:  { label: "Read-only",  color: "#3b82f6", bg: "rgba(59,130,246,0.12)"  },
  blocked:   { label: "Blocked",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
  suspended: { label: "Suspended",  color: "#ef4444", bg: "rgba(239,68,68,0.12)"   },
};

function BlockControls({
  userId,
  currentRestriction,
  onChanged,
  onError,
}: {
  userId: string;
  currentRestriction: "readonly" | "blocked" | "suspended" | null;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [open,      setOpen]      = useState(false);
  const [mode,      setMode]      = useState<"readonly" | "blocked" | "suspended">("blocked");
  const [reason,    setReason]    = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [loading,   setLoading]   = useState(false);

  const handleApply = async () => {
    setLoading(true);
    try {
      await adminSetUserControl(userId, { restriction: mode, reason: reason.trim(), restrictedUntil: untilDate || null } as UserControlPatch);
      onChanged();
      setOpen(false);
      setReason(""); setUntilDate("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to apply restriction");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    try {
      await adminClearUserControl(userId);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to clear restriction");
    } finally {
      setLoading(false);
    }
  };

  const rlabel = currentRestriction ? RESTRICTION_LABELS[currentRestriction] : null;

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {rlabel && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: rlabel.bg, color: rlabel.color, border: `1px solid ${rlabel.color}40` }}>
            {rlabel.label}
          </span>
        )}
        <button onClick={() => setOpen(o => !o)}
          className="text-[10px] px-2 py-1 rounded-lg font-medium transition-colors"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--color-accent-red)" }}>
          {currentRestriction ? "Change restriction ▾" : "Restrict user ▾"}
        </button>
        {currentRestriction && (
          <button onClick={handleClear} disabled={loading}
            className="text-[10px] px-2 py-1 rounded-lg font-medium"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", color: "var(--color-accent-green)" }}>
            ✓ Unblock
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-xl p-3 space-y-2.5"
          style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>
            Restriction level
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {(["readonly", "blocked", "suspended"] as const).map(r => {
              const lbl = RESTRICTION_LABELS[r];
              const active = mode === r;
              return (
                <button key={r} onClick={() => setMode(r)}
                  className="py-2 rounded-lg text-[11px] font-semibold transition-all"
                  style={{
                    background: active ? lbl.bg : "var(--color-bg-muted)",
                    border: `1px solid ${active ? lbl.color + "80" : "var(--color-border)"}`,
                    color: active ? lbl.color : "var(--color-fg-muted)",
                  }}>
                  {lbl.label}
                </button>
              );
            })}
          </div>
          <div className="text-[10px] space-y-1" style={{ color: "var(--color-fg-muted)" }}>
            {mode === "readonly"  && <p>Can view dashboard. Job triggers disabled. Info banner shown.</p>}
            {mode === "blocked"   && <p>Can view dashboard. Job triggers disabled. Warning banner shown.</p>}
            {mode === "suspended" && <p>Sees suspension page only. No dashboard access. Login still works.</p>}
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder={`Reason shown to user (${mode === "suspended" ? "required" : "optional"})`}
            className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
            style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}
          />
          <div className="flex gap-2 items-center">
            <input type="datetime-local" value={untilDate} onChange={e => setUntilDate(e.target.value)}
              title="Auto-expire restriction at"
              className="text-xs rounded-lg px-2 py-1.5 outline-none flex-1"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}
            />
            <span className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>or indefinite</span>
          </div>
          <div className="flex gap-2">
            <button onClick={handleApply} disabled={loading || (mode === "suspended" && !reason.trim())}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
              style={{ background: RESTRICTION_LABELS[mode].bg, border: `1px solid ${RESTRICTION_LABELS[mode].color}60`, color: RESTRICTION_LABELS[mode].color }}>
              {loading ? "Applying…" : `Apply ${RESTRICTION_LABELS[mode].label}`}
            </button>
            <button onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Job status helpers ────────────────────────────────────────────────────────
const JOB_ACTIONS = ["daily_brief", "full_report", "deep_dive", "new_ideas", "switch_production", "switch_testing"] as const;

const ACTION_LABELS: Record<string, string> = {
  daily_brief: "Daily Brief",
  full_report: "Full Report",
  deep_dive: "Deep Dive",
  new_ideas: "New Ideas",
  switch_production: "→ Production",
  switch_testing: "→ Testing",
};

function jobStatusColor(status: AdminJob["status"]): { bg: string; color: string; border: string } {
  if (status === "running")   return { bg: "rgba(245,158,11,0.10)", color: "#f59e0b", border: "rgba(245,158,11,0.35)" };
  if (status === "pending")   return { bg: "rgba(59,130,246,0.08)", color: "#3b82f6", border: "rgba(59,130,246,0.3)" };
  if (status === "completed") return { bg: "rgba(16,185,129,0.08)", color: "#10b981", border: "rgba(16,185,129,0.25)" };
  return { bg: "rgba(239,68,68,0.07)", color: "var(--color-accent-red)", border: "rgba(239,68,68,0.25)" };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── UserJobsPanel ─────────────────────────────────────────────────────────────
function UserJobsPanel({ userId, onError }: { userId: string; onError: (m: string) => void }) {
  const [open, setOpen]             = useState(false);
  const [loading, setLoading]       = useState(false);
  const [jobs, setJobs]             = useState<AdminJob[]>([]);
  const [editJobId, setEditJobId]   = useState<string | null>(null);
  const [editAction, setEditAction] = useState<string>("");
  const [editTicker, setEditTicker] = useState<string>("");
  const [showAdd, setShowAdd]       = useState(false);
  const [addAction, setAddAction]   = useState<string>("daily_brief");
  const [addTicker, setAddTicker]   = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setJobs(await adminListJobs(userId));
    } catch { /* ignore */ }
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const iv = setInterval(() => { void refresh(); }, 8000);
    return () => clearInterval(iv);
  }, [open, refresh]);

  const act = async (fn: () => Promise<void>, optimistic?: () => void) => {
    setLoading(true);
    try {
      optimistic?.();
      await fn();
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setLoading(false);
    }
  };

  const handleKill     = (jobId: string) => act(() => adminKillJob(userId, jobId));
  const handleCancel   = (jobId: string) => act(() => adminCancelJob(userId, jobId));
  const handleContinue = (jobId: string) => act(() => adminContinueJob(userId, jobId));
  const handleWake     = ()               => act(() => adminWakeUser(userId));

  const handleEditSave = (jobId: string) =>
    act(async () => {
      await adminEditJob(userId, jobId, editAction || undefined, editTicker || undefined);
      setEditJobId(null);
    });

  const handleAdd = () =>
    act(async () => {
      if (addAction === "deep_dive" && !addTicker.trim()) { onError("deep_dive requires a ticker"); return; }
      await adminCreateJob(userId, addAction, addTicker.trim() || undefined);
      setShowAdd(false); setAddTicker(""); setAddAction("daily_brief");
    });

  const pending   = jobs.filter(j => j.status === "pending");
  const running   = jobs.filter(j => j.status === "running");
  const failed    = jobs.filter(j => j.status === "failed").slice(0, 5);
  const completed = jobs.filter(j => j.status === "completed").slice(0, 3);

  const activeCount = pending.length + running.length;

  return (
    <div className="border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-[11px] py-1 px-0.5"
        style={{ color: "var(--color-fg-muted)" }}
      >
        <span className="font-semibold uppercase tracking-wide">
          ⚙ Jobs
          {activeCount > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: running.length > 0 ? "rgba(245,158,11,0.2)" : "rgba(59,130,246,0.15)",
                       color: running.length > 0 ? "#f59e0b" : "#3b82f6" }}>
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">

          {/* Running jobs */}
          {running.map(job => {
            const c = jobStatusColor("running");
            return (
              <div key={job.id} className="rounded-lg p-2.5 space-y-1.5"
                style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold" style={{ color: c.color }}>
                      ● {ACTION_LABELS[job.action] ?? job.action}
                      {job.ticker && <span className="ml-1 opacity-70">({job.ticker})</span>}
                    </span>
                    <span className="ml-2 text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                      {timeAgo(job.triggered_at)}
                    </span>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button disabled={loading} onClick={() => handleContinue(job.id)}
                      className="text-[10px] px-2 py-0.5 rounded font-medium"
                      style={{ background: "rgba(16,185,129,0.12)", color: "#10b981", border: "1px solid rgba(16,185,129,0.3)" }}>
                      Nudge
                    </button>
                    <button disabled={loading} onClick={() => handleKill(job.id)}
                      className="text-[10px] px-2 py-0.5 rounded font-medium"
                      style={{ background: "rgba(239,68,68,0.1)", color: "var(--color-accent-red)", border: "1px solid rgba(239,68,68,0.3)" }}>
                      Kill
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Pending jobs */}
          {pending.map(job => {
            const c = jobStatusColor("pending");
            const isEditing = editJobId === job.id;
            return (
              <div key={job.id} className="rounded-lg p-2.5 space-y-1.5"
                style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold" style={{ color: c.color }}>
                      ○ {ACTION_LABELS[job.action] ?? job.action}
                      {job.ticker && <span className="ml-1 opacity-70">({job.ticker})</span>}
                    </span>
                    <span className="ml-2 text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>
                      {timeAgo(job.triggered_at)}
                    </span>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button disabled={loading} onClick={() => { setEditJobId(isEditing ? null : job.id); setEditAction(job.action); setEditTicker(job.ticker ?? ""); }}
                      className="text-[10px] px-2 py-0.5 rounded font-medium"
                      style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)", border: "1px solid var(--color-border)" }}>
                      {isEditing ? "Close" : "Edit"}
                    </button>
                    <button disabled={loading} onClick={() => handleContinue(job.id)}
                      className="text-[10px] px-2 py-0.5 rounded font-medium"
                      style={{ background: "rgba(16,185,129,0.10)", color: "#10b981", border: "1px solid rgba(16,185,129,0.25)" }}>
                      Wake
                    </button>
                    <button disabled={loading} onClick={() => handleCancel(job.id)}
                      className="text-[10px] px-2 py-0.5 rounded font-medium"
                      style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-accent-red)", border: "1px solid rgba(239,68,68,0.25)" }}>
                      Cancel
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: "rgba(59,130,246,0.2)" }}>
                    <div className="flex gap-1.5">
                      <select value={editAction} onChange={e => setEditAction(e.target.value)}
                        className="flex-1 text-[11px] rounded px-2 py-1 outline-none"
                        style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}>
                        {JOB_ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                      </select>
                      {(editAction === "deep_dive") && (
                        <input value={editTicker} onChange={e => setEditTicker(e.target.value.toUpperCase())}
                          placeholder="TICKER"
                          className="w-20 text-[11px] rounded px-2 py-1 outline-none uppercase"
                          style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }} />
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <button disabled={loading} onClick={() => handleEditSave(job.id)}
                        className="flex-1 py-1 text-[10px] rounded font-semibold"
                        style={{ background: "var(--color-accent-blue)", color: "white" }}>
                        Save
                      </button>
                      <button onClick={() => setEditJobId(null)}
                        className="px-3 py-1 text-[10px] rounded"
                        style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty active state */}
          {running.length === 0 && pending.length === 0 && (
            <p className="text-[10px] text-center py-1" style={{ color: "var(--color-fg-subtle)" }}>No active jobs</p>
          )}

          {/* Failed jobs */}
          {failed.length > 0 && (
            <details className="group">
              <summary className="text-[10px] cursor-pointer select-none" style={{ color: "var(--color-fg-subtle)" }}>
                {failed.length} recent failure{failed.length > 1 ? "s" : ""} ▾
              </summary>
              <div className="mt-1 space-y-1">
                {failed.map(job => (
                  <div key={job.id} className="rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2"
                    style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <div className="min-w-0">
                      <span className="text-[10px] font-medium" style={{ color: "var(--color-accent-red)" }}>
                        {ACTION_LABELS[job.action] ?? job.action}{job.ticker ? ` (${job.ticker})` : ""}
                      </span>
                      {job.error && (
                        <p className="text-[9px] truncate" style={{ color: "var(--color-fg-subtle)" }}>{job.error}</p>
                      )}
                    </div>
                    <button disabled={loading} onClick={() => handleContinue(job.id)}
                      className="shrink-0 text-[10px] px-2 py-0.5 rounded font-medium"
                      style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)" }}>
                      Retry
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Completed preview */}
          {completed.length > 0 && failed.length === 0 && (
            <div className="space-y-0.5">
              {completed.slice(0, 2).map(job => (
                <div key={job.id} className="text-[10px] flex items-center justify-between px-1"
                  style={{ color: "var(--color-fg-subtle)" }}>
                  <span>✓ {ACTION_LABELS[job.action] ?? job.action}{job.ticker ? ` (${job.ticker})` : ""}</span>
                  <span>{timeAgo(job.triggered_at)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions bar */}
          <div className="flex gap-1.5 pt-1">
            <button onClick={() => { setShowAdd(o => !o); }} disabled={loading}
              className="text-[10px] px-2.5 py-1 rounded-lg font-medium flex-1"
              style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
              {showAdd ? "Cancel" : "+ Add Job"}
            </button>
            <button onClick={handleWake} disabled={loading}
              className="text-[10px] px-2.5 py-1 rounded-lg font-medium"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
              ⚡ Wake All
            </button>
          </div>

          {/* Add job form */}
          {showAdd && (
            <div className="rounded-lg p-2.5 space-y-2"
              style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>
                New Job for {userId}
              </p>
              <div className="flex gap-1.5">
                <select value={addAction} onChange={e => setAddAction(e.target.value)}
                  className="flex-1 text-[11px] rounded-lg px-2 py-1.5 outline-none"
                  style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }}>
                  {JOB_ACTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                </select>
                {addAction === "deep_dive" && (
                  <input value={addTicker} onChange={e => setAddTicker(e.target.value.toUpperCase())}
                    placeholder="TICKER"
                    className="w-24 text-[11px] rounded-lg px-2 py-1.5 outline-none uppercase"
                    style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }} />
                )}
              </div>
              <button disabled={loading} onClick={handleAdd}
                className="w-full py-1.5 rounded-lg text-[11px] font-semibold"
                style={{ background: "var(--color-accent-blue)", color: "white" }}>
                {loading ? "Queuing…" : `Queue ${ACTION_LABELS[addAction] ?? addAction}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
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
  onControlChanged,
  onError,
}: {
  user: UserSummary;
  profiles: ProfilesRegistry;
  onDelete: (userId: string) => void;
  onUpdateLimits: (userId: string, limits: Partial<RateLimits>) => void;
  onAddTelegram: (userId: string, botToken: string, chatId: string) => void;
  onProfileChanged: () => void;
  onControlChanged: () => void;
  onError: (msg: string) => void;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [showLimits,    setShowLimits]    = useState(false);
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showTelegram,  setShowTelegram]  = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [botToken,      setBotToken]      = useState("");
  const [chatId,        setChatId]        = useState(user.telegramChatId ?? "");

  const restriction = user.restriction;

  const stateColor =
    user.state === "ACTIVE"        ? "text-[var(--color-accent-green)]" :
    user.state === "BOOTSTRAPPING" ? "text-[var(--color-accent-yellow)]" :
                                     "text-[var(--color-fg-muted)]";

  const handleDelete = async () => {
    if (deleteConfirm !== user.userId) return;
    setDeleting(true);
    try { await onDelete(user.userId); }
    finally { setDeleting(false); setShowDelete(false); setDeleteConfirm(""); }
  };

  const handleForceLogout = async () => {
    setLogoutLoading(true);
    try { await adminForceLogout(user.userId); }
    catch (e) { onError(e instanceof Error ? e.message : "Force logout failed"); }
    finally { setLogoutLoading(false); }
  };

  const stateLabel     = user.state === "ACTIVE" ? t("adminStateActive", language)
    : user.state === "BOOTSTRAPPING"              ? t("adminStateBootstrapping", language)
    : user.state;
  const portfolioLabel = user.portfolioLoaded ? t("adminPortfolioLoaded", language) : t("adminPortfolioMissing", language);

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{
        background: "var(--color-bg-subtle)",
        borderColor: restriction === "suspended" ? "rgba(239,68,68,0.4)"
          : restriction === "blocked"  ? "rgba(245,158,11,0.4)"
          : restriction === "readonly" ? "rgba(59,130,246,0.3)"
          : "var(--color-border)",
      }}>

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm" style={{ color: "var(--color-fg-default)" }}>{user.displayName}</span>
            <span className="text-[10px] font-mono" style={{ color: "var(--color-fg-subtle)" }}>@{user.userId}</span>
          </div>
          <p className={`text-[10px] font-medium uppercase mt-0.5 ${stateColor}`}>
            {stateLabel} · {portfolioLabel}
          </p>
        </div>
        <HealthBadge health={user.agentHealth} />
      </div>

      {/* Meta row */}
      <div className="text-[11px] space-y-0.5" style={{ color: "var(--color-fg-muted)" }}>
        {user.hasTelegram
          ? <p>{t("adminTelegramYes", language)}{user.telegramChatId ? ` (${user.telegramChatId})` : ""}</p>
          : <p>{t("adminTelegramNo", language)}</p>}
        <p>
          {t("adminDeepDives", language)} {user.rateLimits.deep_dive.maxPerPeriod}/{t("perDay", language).replace("/ ","")} ·{" "}
          {t("adminFullReportsLabel", language)} {user.rateLimits.full_report.maxPerPeriod}/{t("perWeek", language).replace("/ ","")}
        </p>
        <UserActivityBadge userId={user.userId} />
      </div>

      {/* Block controls */}
      <BlockControls
        userId={user.userId}
        currentRestriction={restriction}
        onChanged={onControlChanged}
        onError={onError}
      />

      {/* Jobs panel */}
      <UserJobsPanel userId={user.userId} onError={onError} />

      {/* Actions row */}
      <div className="flex gap-1.5 flex-wrap pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
        <ProfileBadge
          userId={user.userId}
          current={user.modelProfile}
          profiles={profiles}
          onChanged={onProfileChanged}
          onError={onError}
        />
        <button onClick={() => setShowTelegram(!showTelegram)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium"
          style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
          {user.hasTelegram ? t("adminEditTelegram", language) : t("adminAddTelegram", language)}
        </button>
        <button onClick={() => setShowLimits(!showLimits)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium"
          style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
          {t("adminEditLimits", language)}
        </button>
        <button onClick={handleForceLogout} disabled={logoutLoading}
          title="Invalidate all active sessions"
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-40"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#f59e0b" }}>
          {logoutLoading ? "…" : "⟳ Force logout"}
        </button>
        <button onClick={() => setShowDelete(true)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium ml-auto"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--color-accent-red)" }}>
          {t("delete", language)}
        </button>
      </div>

      {/* Edit Telegram */}
      {showTelegram && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-fg-muted)" }}>{t("adminTelegramSection", language)}</p>
          <input value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="Bot token"
            className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
            style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }} />
          <input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="Chat ID"
            className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
            style={{ background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", color: "var(--color-fg-default)" }} />
          <div className="flex gap-2">
            <button onClick={() => { onAddTelegram(user.userId, botToken, chatId); setShowTelegram(false); }}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: "var(--color-accent-blue)", color: "white" }}>
              {t("adminSaveTelegram", language)}
            </button>
            <button onClick={() => setShowTelegram(false)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
              {t("cancel", language)}
            </button>
          </div>
        </div>
      )}

      {/* Rate Limits */}
      {showLimits && (
        <div className="rounded-lg p-3" style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-fg-muted)" }}>{t("adminRateLimitsSection", language)}</p>
          <RateLimitsEditor
            limits={user.rateLimits}
            onSave={(l) => { onUpdateLimits(user.userId, l); setShowLimits(false); }}
            onCancel={() => setShowLimits(false)}
          />
        </div>
      )}

      {/* Delete confirm */}
      {showDelete && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <p className="text-xs font-semibold" style={{ color: "var(--color-accent-red)" }}>
            {t("adminTypeToConfirm", language)} <code>{user.userId}</code> {t("adminToConfirmDeletion", language)}
          </p>
          <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
            placeholder={user.userId}
            className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
            style={{ background: "var(--color-bg-muted)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--color-fg-default)" }} />
          <div className="flex gap-2">
            <button onClick={handleDelete} disabled={deleteConfirm !== user.userId || deleting}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "var(--color-accent-red)" }}>
              {deleting ? t("adminDeleting", language) : t("adminConfirmDelete", language)}
            </button>
            <button onClick={() => { setShowDelete(false); setDeleteConfirm(""); }}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--color-bg-muted)", color: "var(--color-fg-muted)" }}>
              {t("cancel", language)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SystemAgentCard({
  agent,
  profiles,
  onProfileChanged,
  onError,
}: {
  agent: SystemAgentSummary;
  profiles: ProfilesRegistry;
  onProfileChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const handleSwitch = async (profileName: string) => {
    setOpen(false);
    try {
      await adminSetSystemAgentProfile(profileName);
      onProfileChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to switch system agent profile");
    }
  };

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm" style={{ color: "var(--color-fg-default)" }}>
              Root System Agent
            </span>
            <span className="text-[10px] font-mono" style={{ color: "var(--color-fg-subtle)" }}>
              @{agent.agentId}
            </span>
          </div>
          <p className="text-[10px] font-medium uppercase mt-0.5 text-[var(--color-accent-blue)]">
            Default PM / developer agent
          </p>
        </div>
        <HealthBadge health={agent.agentHealth} />
      </div>

      <div className="text-[11px] space-y-0.5" style={{ color: "var(--color-fg-muted)" }}>
        <p>Workspace: {agent.workspace}</p>
        <p>{agent.configured ? "Configured in OpenClaw" : "Missing from OpenClaw config"}</p>
        <p>
          {agent.hasTelegram
            ? `Telegram bot bound to account ${agent.telegramAccountId ?? "main"}`
            : "Telegram bot is not bound to the system agent"}
        </p>
        {agent.profileBroken && agent.profileBrokenReason && (
          <p style={{ color: "var(--color-accent-red)" }}>{agent.profileBrokenReason}</p>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap pt-1 border-t" style={{ borderColor: "var(--color-border)" }}>
        <div className="relative inline-block">
          <button
            onClick={() => setOpen((value) => !value)}
            className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-400"
          >
            {agent.modelProfile} ▾
          </button>
          {open && (
            <div className="absolute left-0 top-6 z-20 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[140px]">
              {Object.keys(profiles).map((name) => (
                <button
                  key={name}
                  onClick={() => handleSwitch(name)}
                  className={`w-full text-left text-xs px-3 py-1.5 hover:bg-[var(--color-bg-muted)] ${
                    name === agent.modelProfile
                      ? "font-bold text-[var(--color-accent-blue)]"
                      : "text-[var(--color-fg-default)]"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Main Admin Page ----
export function Admin() {
  const language = usePreferencesStore((s) => s.language);
  const isLoggedIn = !!sessionStorage.getItem("admin_key");
  const [loggedIn, setLoggedIn] = useState(isLoggedIn);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [systemAgent, setSystemAgent] = useState<SystemAgentSummary | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [profiles, setProfiles] = useState<ProfilesRegistry>({});
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, system, { users: u }, { profiles: p }] = await Promise.all([
        adminGetStatus(),
        adminGetSystemAgent(),
        adminFetchUsers(),
        adminFetchProfiles(),
      ]);
      setStatus(s);
      setSystemAgent(system);
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
    <div className="min-h-screen" style={{ background: "var(--color-bg-base)", color: "var(--color-fg-default)" }}>

      {/* Sticky header */}
      <div className="sticky top-0 z-30 border-b px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--color-bg-subtle)", borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">🦞</span>
          <span className="font-bold text-sm">{t("adminTitle", language)}</span>
        </div>
        <div className="flex items-center gap-3">
          {status && (
            <span className={`text-[11px] font-medium ${status.gatewayRunning ? "text-[var(--color-accent-green)]" : "text-[var(--color-accent-red)]"}`}>
              {status.gatewayRunning ? "● Gateway running" : "● Gateway stopped"}
            </span>
          )}
          <button onClick={() => { sessionStorage.removeItem("admin_key"); setLoggedIn(false); }}
            className="text-[10px] px-2 py-1 rounded"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
            {t("logout", language)}
          </button>
        </div>
      </div>

      <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">

        {/* Stat bar */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t("adminUsers", language), value: `${users.length} ${t("adminTotal", language)}`, accent: false },
            { label: t("adminActive", language), value: status?.activeAgents ?? "—", accent: true },
            { label: t("adminGateway", language), value: status?.gatewayRunning ? t("adminRunning", language) : t("adminStopped", language), accent: !!status?.gatewayRunning },
          ].map(s => (
            <div key={s.label} className="rounded-lg px-4 py-3 text-center"
              style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}>
              <p className="text-[10px]" style={{ color: "var(--color-fg-subtle)" }}>{s.label}</p>
              <p className={`text-sm font-bold mt-0.5 ${s.accent ? "text-[var(--color-accent-green)]" : ""}`}
                style={!s.accent ? { color: "var(--color-fg-default)" } : undefined}>
                {String(s.value)}
              </p>
            </div>
          ))}
        </div>

        {/* System controls */}
        <SystemControls onError={(m) => setError(m)} />

        {systemAgent && (
          <SystemAgentCard
            agent={systemAgent}
            profiles={profiles}
            onProfileChanged={load}
            onError={setError}
          />
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded-lg px-3 py-2 text-xs flex items-center justify-between"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--color-accent-red)" }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Add User */}
        <button onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-xl text-sm font-semibold"
          style={{ background: "var(--color-accent-blue)", color: "white" }}>
          + {t("adminAddUser", language)}
        </button>

        {/* User cards */}
        {loading && users.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: "var(--color-fg-muted)" }}>{t("loading", language)}</div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: "var(--color-fg-muted)" }}>{t("adminNoUsers", language)}</div>
        ) : (
          <div className="space-y-3">
            {users.map(u => (
              <UserCard
                key={u.userId}
                user={u}
                profiles={profiles}
                onDelete={handleDelete}
                onUpdateLimits={handleUpdateLimits}
                onAddTelegram={handleAddTelegram}
                onProfileChanged={load}
                onControlChanged={load}
                onError={setError}
              />
            ))}
          </div>
        )}

        {/* Model Profiles (collapsible, at bottom) */}
        <details className="group rounded-xl border overflow-hidden"
          style={{ borderColor: "var(--color-border)" }}>
          <summary className="px-4 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none flex items-center justify-between"
            style={{ background: "var(--color-bg-subtle)", color: "var(--color-fg-muted)", listStyle: "none" }}>
            <span>⚙️ {t("adminModelProfiles", language)}</span>
            <span className="group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="p-4" style={{ background: "var(--color-bg-base)" }}>
            <ProfilesSection onError={setError} />
          </div>
        </details>

      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  );
}
