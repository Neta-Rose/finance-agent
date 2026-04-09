import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useToastStore } from "../store/toastStore";
import { usePreferencesStore, type Theme, type Language } from "../store/preferencesStore";
import { t, type TranslationKey } from "../store/i18n";
import { apiClient } from "../api/client";
import { fetchOnboardStatus } from "../api/onboarding";
import { useQuery } from "@tanstack/react-query";
import { TopBar } from "../components/ui/TopBar";
import { Card } from "../components/ui/Card";
import { User, Lock, Clock, Bot, BarChart2, LogOut, ChevronRight, X, Sun, Moon, Monitor } from "lucide-react";

const DAY_KEYS: Array<{ value: string; key: TranslationKey }> = [
  { value: "sunday", key: "daySunday" },
  { value: "monday", key: "dayMonday" },
  { value: "tuesday", key: "dayTuesday" },
  { value: "wednesday", key: "dayWednesday" },
  { value: "thursday", key: "dayThursday" },
  { value: "friday", key: "dayFriday" },
  { value: "saturday", key: "daySaturday" },
];

const TIMEZONES = [
  { value: "Asia/Jerusalem", label: "Asia/Jerusalem (UTC+3)" },
  { value: "America/New_York", label: "America/New_York (UTC-5)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (UTC-8)" },
  { value: "America/Chicago", label: "America/Chicago (UTC-6)" },
  { value: "Europe/London", label: "Europe/London (UTC+0)" },
  { value: "Europe/Paris", label: "Europe/Paris (UTC+1)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (UTC+8)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (UTC+11)" },
];

const inputCls = "w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)] appearance-none";
const labelCls = "text-xs font-medium text-[var(--color-fg-muted)] mb-1.5 block";

export function Settings() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const showToast = useToastStore((s) => s.show);
  const lang = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);

  const { data: onboardStatus } = useQuery({
    queryKey: ["onboard-status"],
    queryFn: fetchOnboardStatus,
    staleTime: 60_000,
  });

  // Change password form
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Schedule form
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedule, setSchedule] = useState({
    dailyBriefTime: onboardStatus?.schedule?.dailyBriefTime ?? "08:00",
    weeklyResearchDay: onboardStatus?.schedule?.weeklyResearchDay ?? "sunday",
    weeklyResearchTime: onboardStatus?.schedule?.weeklyResearchTime ?? "19:00",
    timezone: onboardStatus?.schedule?.timezone ?? "Asia/Jerusalem",
  });
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // Telegram form
  const [showTelegramForm, setShowTelegramForm] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramError, setTelegramError] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    if (!currentPassword) { setPasswordError(t("errorCurrentPasswordRequired", lang)); return; }
    if (!newPassword || newPassword.length < 8) { setPasswordError(t("errorPasswordTooShort", lang)); return; }
    if (newPassword !== confirmPassword) { setPasswordError(t("errorPasswordMismatch", lang)); return; }

    setPasswordLoading(true);
    try {
      await apiClient.post("/onboard/change-password", { currentPassword, newPassword });
      showToast(t("passwordChangedSuccess", lang), "success");
      setShowPasswordForm(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      if (axiosErr.response?.data?.error === "incorrect_password") {
        setPasswordError(t("errorIncorrectPassword", lang));
      } else {
        setPasswordError(t("errorChangePassword", lang));
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSaveSchedule = async () => {
    setScheduleLoading(true);
    try {
      await apiClient.patch("/onboard/schedule", schedule);
      showToast(t("scheduleUpdated", lang), "success");
      setShowScheduleForm(false);
    } catch {
      showToast(t("errorUpdateSchedule", lang), "error");
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleConnectTelegram = async () => {
    setTelegramError("");
    if (!botToken.trim() || !telegramChatId.trim()) {
      setTelegramError(t("errorBothFields", lang));
      return;
    }
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken)) {
      setTelegramError(t("errorInvalidBotToken", lang));
      return;
    }
    if (!/^\d+$/.test(telegramChatId)) {
      setTelegramError(t("errorInvalidChatId", lang));
      return;
    }
    setTelegramLoading(true);
    try {
      await apiClient.post("/onboard/telegram", { botToken, telegramChatId });
      showToast(t("telegramConnected", lang), "success");
      setShowTelegramForm(false);
      setBotToken("");
      setTelegramChatId("");
    } catch {
      setTelegramError(t("errorConnectTelegram", lang));
    } finally {
      setTelegramLoading(false);
    }
  };

  const rateLimits = onboardStatus?.rateLimits;
  const statusSchedule = onboardStatus?.schedule;
  const telegramConnected = onboardStatus?.telegramConnected ?? false;

  const themeOptions: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
    { value: "dark", label: t("dark", lang), icon: <Moon size={16} /> },
    { value: "middle", label: t("middle", lang), icon: <Monitor size={16} /> },
    { value: "bright", label: t("bright", lang), icon: <Sun size={16} /> },
  ];

  const langOptions: Array<{ value: Language; label: string }> = [
    { value: "en", label: t("english", lang) },
    { value: "he", label: t("hebrew", lang) },
  ];

  return (
    <div className="bg-[var(--color-bg-base)] min-h-screen pb-20">
      <TopBar title={`⚙️ ${t("settings", lang)}`} />

      <div className="p-4 space-y-4">

        {/* Account */}
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <User size={12} /> {t("account", lang).toUpperCase()}
          </h3>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-[var(--color-fg-muted)]">{t("displayName", lang)}</p>
                <p className="text-sm font-semibold text-[var(--color-fg-default)]">{onboardStatus?.displayName ?? "—"}</p>
              </div>
            </div>
          </Card>
        </section>

        {/* Appearance */}
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Sun size={12} /> {t("appearance", lang).toUpperCase()}
          </h3>
          <Card className="p-4 space-y-4">
            {/* Theme */}
            <div>
              <p className="text-xs text-[var(--color-fg-muted)] mb-2">{t("theme", lang)}</p>
              <div className="flex gap-2">
                {themeOptions.map((opt) => {
                  const currentTheme = usePreferencesStore((s) => s.theme);
                  const setTheme = usePreferencesStore((s) => s.setTheme);
                  const isActive = currentTheme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value)}
                      className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border text-xs font-medium transition-colors ${
                        isActive
                          ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]"
                          : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)]"
                      }`}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Language */}
            <div>
              <p className="text-xs text-[var(--color-fg-muted)] mb-2">{t("language", lang)}</p>
              <div className="flex gap-2">
                {langOptions.map((opt) => {
                  const isActive = lang === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setLanguage(opt.value)}
                      className={`flex-1 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                        isActive
                          ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]"
                          : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-fg-subtle)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        </section>

        {/* Security */}
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Lock size={12} /> {t("security", lang).toUpperCase()}
          </h3>
          <Card className="p-0 divide-y divide-[var(--color-border)]">
            {!showPasswordForm ? (
              <button
                onClick={() => setShowPasswordForm(true)}
                className="w-full flex items-center justify-between p-4 text-sm text-[var(--color-fg-default)] hover:bg-[var(--color-bg-muted)] transition-colors"
              >
                <span>{t("changePassword", lang)}</span>
                <ChevronRight size={16} className="text-[var(--color-fg-subtle)]" />
              </button>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-[var(--color-fg-default)]">{t("changePassword", lang)}</p>
                  <button onClick={() => setShowPasswordForm(false)} className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]">
                    <X size={16} />
                  </button>
                </div>
                <div>
                  <label className={labelCls}>{t("currentPassword", lang)}</label>
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("newPassword", lang)}</label>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("confirmPassword", lang)}</label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} />
                </div>
                {passwordError && <p className="text-[10px] text-[var(--color-accent-red)]">{passwordError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => setShowPasswordForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-fg-muted)]">{t("cancel", lang)}</button>
                  <button onClick={handleChangePassword} disabled={passwordLoading} className="flex-1 py-2 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold disabled:opacity-50">
                    {passwordLoading ? "..." : t("save", lang)}
                  </button>
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* Schedule */}
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Clock size={12} /> {t("schedule", lang).toUpperCase()}
          </h3>
          {!showScheduleForm ? (
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-fg-muted)]">{t("dailyBrief", lang)}</span>
                <span className="text-[var(--color-fg-default)] font-medium">{statusSchedule?.dailyBriefTime ?? "08:00"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-fg-muted)]">{t("weeklyResearch", lang)}</span>
                <span className="text-[var(--color-fg-default)] font-medium">
                  {t(DAY_KEYS.find(d => d.value === (statusSchedule?.weeklyResearchDay ?? "sunday"))?.key ?? "daySunday", lang)} {statusSchedule?.weeklyResearchTime ?? "19:00"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-fg-muted)]">{t("timezone", lang)}</span>
                <span className="text-[var(--color-fg-default)] font-medium">{statusSchedule?.timezone ?? "Asia/Jerusalem"}</span>
              </div>
              <button
                onClick={() => setShowScheduleForm(true)}
                className="w-full mt-2 py-2 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-accent-blue)]"
              >
                {t("edit", lang)}
              </button>
            </Card>
          ) : (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[var(--color-fg-default)]">{t("schedule", lang)}</p>
                <button onClick={() => setShowScheduleForm(false)} className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]">
                  <X size={16} />
                </button>
              </div>
              <div>
                <label className={labelCls}>{t("dailyBrief", lang)}</label>
                <input type="time" value={schedule.dailyBriefTime} onChange={(e) => setSchedule(s => ({ ...s, dailyBriefTime: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("weeklyResearch", lang)}</label>
                <select value={schedule.weeklyResearchDay} onChange={(e) => setSchedule(s => ({ ...s, weeklyResearchDay: e.target.value }))} className={inputCls}>
                  {DAY_KEYS.map(d => <option key={d.value} value={d.value}>{t(d.key, lang)}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t("weeklyResearch", lang)}</label>
                <input type="time" value={schedule.weeklyResearchTime} onChange={(e) => setSchedule(s => ({ ...s, weeklyResearchTime: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("timezone", lang)}</label>
                <select value={schedule.timezone} onChange={(e) => setSchedule(s => ({ ...s, timezone: e.target.value }))} className={inputCls}>
                  {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowScheduleForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-fg-muted)]">{t("cancel", lang)}</button>
                <button onClick={handleSaveSchedule} disabled={scheduleLoading} className="flex-1 py-2 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold disabled:opacity-50">
                  {scheduleLoading ? "..." : t("save", lang)}
                </button>
              </div>
            </Card>
          )}
        </section>

        {/* Telegram */}
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <Bot size={12} /> {t("telegram", lang).toUpperCase()}
          </h3>
          {!showTelegramForm ? (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm text-[var(--color-fg-default)]">
                    {telegramConnected ? `✓ ${t("statusConnected", lang)}` : `✗ ${t("statusNotConnected", lang)}`}
                  </p>
                </div>
                <button
                  onClick={() => setShowTelegramForm(true)}
                  className="py-1.5 px-3 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold"
                >
                  {telegramConnected ? t("disconnect", lang) : t("connect", lang)}
                </button>
              </div>
            </Card>
          ) : (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[var(--color-fg-default)]">{t("telegram", lang)}</p>
                <button onClick={() => setShowTelegramForm(false)} className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]">
                  <X size={16} />
                </button>
              </div>
              <div>
                <label className={labelCls}>{t("botToken", lang)}</label>
                <input type="text" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456789:ABC-xyz..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("chatId", lang)}</label>
                <input type="text" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value.replace(/\D/g, ""))} placeholder="123456789" className={inputCls} />
              </div>
              {telegramError && <p className="text-[10px] text-[var(--color-accent-red)]">{telegramError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowTelegramForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-fg-muted)]">{t("cancel", lang)}</button>
                <button onClick={handleConnectTelegram} disabled={telegramLoading} className="flex-1 py-2 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold disabled:opacity-50">
                  {telegramLoading ? "..." : t("connect", lang)}
                </button>
              </div>
            </Card>
          )}
        </section>

        {/* Rate Limits */}
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-fg-muted)] uppercase mb-2 flex items-center gap-1.5">
            <BarChart2 size={12} /> {t("rateLimits", lang).toUpperCase()}
          </h3>
          <Card className="p-4 space-y-2">
            {rateLimits ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-fg-muted)]">{t("fullReport", lang)}</span>
                  <span className="text-[var(--color-fg-default)] font-medium">{rateLimits.full_report.maxPerPeriod} {t("perWeek", lang)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-fg-muted)]">{t("dailyBriefLimit", lang)}</span>
                  <span className="text-[var(--color-fg-default)] font-medium">{rateLimits.daily_brief.maxPerPeriod} {t("perDay", lang)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-fg-muted)]">{t("deepDiveLimit", lang)}</span>
                  <span className="text-[var(--color-fg-default)] font-medium">{rateLimits.deep_dive.maxPerPeriod} {t("perDay", lang)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-fg-muted)]">{t("newIdeasLimit", lang)}</span>
                  <span className="text-[var(--color-fg-default)] font-medium">{rateLimits.new_ideas.maxPerPeriod} {t("perWeek", lang)}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--color-fg-muted)]">...</p>
            )}
            <p className="text-[10px] text-[var(--color-fg-subtle)] pt-1">{t("setByAdmin", lang)}</p>
          </Card>
        </section>

        {/* Logout */}
        <section>
          <button
            onClick={handleLogout}
            className="w-full py-3 rounded-lg bg-[var(--color-accent-red)] text-white text-sm font-semibold flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            {t("logout", lang)}
          </button>
        </section>

      </div>
    </div>
  );
}
