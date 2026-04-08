import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useToastStore } from "../store/toastStore";
import { submitOnboardInit, submitPortfolio, type PositionEntry } from "../api/onboarding";
import { login } from "../api/auth";
import { generateId } from "../utils/id";
import { apiClient } from "../api/client";

const EXCHANGES = [
  { value: "NYSE", label: "NYSE", currency: "USD" },
  { value: "NASDAQ", label: "NASDAQ", currency: "USD" },
  { value: "TASE", label: "TASE", currency: "ILA" },
  { value: "LSE", label: "LSE (London)", currency: "GBP" },
  { value: "XETRA", label: "XETRA (Germany)", currency: "EUR" },
  { value: "EURONEXT", label: "Euronext", currency: "EUR" },
  { value: "OTHER", label: "Other", currency: "USD" },
] as const;

const CURRENCIES = ["USD", "ILA", "GBP", "EUR"] as const;
type Exchange = typeof EXCHANGES[number]["value"];
type Currency = typeof CURRENCIES[number];

const DAYS = [
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
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

interface Account {
  id: string;
  name: string;
  positions: PositionEntry[];
}

interface OnboardingState {
  step: 1 | 2 | 3 | 4 | 5;
  adminKey: string;
  userId: string;
  password: string;
  confirmPassword: string;
  currentPassword: string;
  displayName: string;
  telegramChatId: string;
  dailyBriefTime: string;
  weeklyResearchDay: string;
  weeklyResearchTime: string;
  timezone: string;
  accounts: Account[];
  // Telegram step fields
  botToken: string;
  telegramSkip: boolean;
}

const initialState = {
  step: 1,
  adminKey: "",
  userId: "",
  password: "",
  confirmPassword: "",
  currentPassword: "",
  displayName: "",
  telegramChatId: "",
  dailyBriefTime: "08:00",
  weeklyResearchDay: "sunday",
  weeklyResearchTime: "19:00",
  timezone: "Asia/Jerusalem",
  accounts: [] as Account[],
  botToken: "",
  telegramSkip: false,
};

const inputCls = "w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)] appearance-none";
const labelCls = "text-xs font-medium text-[var(--color-fg-muted)] mb-1.5 block";
const errorCls = "text-[10px] text-[var(--color-accent-red)] mt-1";

function ProgressDots({ step, total = 5 }: { step: number; total?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
            s < step ? "bg-[var(--color-accent-green)] text-white"
            : s === step ? "bg-[var(--color-accent-blue)] text-white"
            : "border border-[var(--color-border)] text-[var(--color-fg-subtle)]"
          }`}>{s < step ? "✓" : s}</div>
          {s < total && <div className={`w-6 h-0.5 ${s < step ? "bg-[var(--color-accent-green)]" : "bg-[var(--color-border)]"}`} />}
        </div>
      ))}
    </div>
  );
}

function BottomBar({ onBack, onNext, nextLabel = "Next", nextDisabled = false, showBack = true }: {
  onBack?: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean; showBack?: boolean;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-subtle)] border-t border-[var(--color-border)] p-4 flex gap-3 safe-bottom z-30">
      {showBack ? (
        <button onClick={onBack} className="flex-1 py-3 rounded-lg border border-[var(--color-border)] text-sm font-semibold text-[var(--color-fg-muted)]">← Back</button>
      ) : <div className="flex-1" />}
      <button onClick={onNext} disabled={nextDisabled}
        className="flex-1 py-3 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold disabled:opacity-50">
        {nextLabel}
      </button>
    </div>
  );
}

function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-4 mb-2">
      <h2 className="text-base font-bold text-[var(--color-fg-default)]">{title}</h2>
      {subtitle && <p className="text-xs text-[var(--color-fg-muted)] mt-0.5">{subtitle}</p>}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return message ? <p className={errorCls}>{message}</p> : null;
}

// ---- Step 1: New User Account Setup ----
function Step1({ state, update, onNext }: { state: OnboardingState; update: <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => void; onNext: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!state.adminKey.trim()) e.adminKey = "Required";
    if (!state.userId.trim()) e.userId = "Required";
    else if (!/^[a-zA-Z0-9-]{4,32}$/.test(state.userId)) e.userId = "4-32 alphanumeric or hyphens";
    if (!state.password) e.password = "Required";
    else if (state.password.length < 8) e.password = "Min 8 characters";
    if (state.password !== state.confirmPassword) e.confirmPassword = "Passwords do not match";
    if (!state.displayName.trim()) e.displayName = "Required";
    return e;
  };

  const handleNext = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length === 0) onNext();
  };

  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle title="Account Setup" subtitle="Create your portfolio agent account" />
        <div><label className={labelCls}>Beta Access Code</label><input type="text" value={state.adminKey} onChange={(e) => update("adminKey", e.target.value)} placeholder="Enter your beta access code" className={inputCls} /><FieldError message={errors.adminKey} /></div>
        <div><label className={labelCls}>User ID</label><input type="text" value={state.userId} onChange={(e) => update("userId", e.target.value.toLowerCase().replace(/[^a-zA-Z0-9-]/g, ""))} placeholder="john-doe" maxLength={32} className={inputCls} /><p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">Login identifier. Cannot be changed.</p><FieldError message={errors.userId} /></div>
        <div><label className={labelCls}>Password</label><input type="password" value={state.password} onChange={(e) => update("password", e.target.value)} placeholder="Min 8 characters" className={inputCls} /><FieldError message={errors.password} /></div>
        <div><label className={labelCls}>Confirm Password</label><input type="password" value={state.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} placeholder="Repeat your password" className={inputCls} /><FieldError message={errors.confirmPassword} /></div>
        <div><label className={labelCls}>Display Name</label><input type="text" value={state.displayName} onChange={(e) => update("displayName", e.target.value)} placeholder="How should we call you?" className={inputCls} /><FieldError message={errors.displayName} /></div>
      </div>
      <BottomBar onNext={handleNext} showBack={false} />
    </>
  );
}

// ---- Step 1: Authenticated User — Change Password ----
function AuthStep1({ state, update, onNext }: { state: OnboardingState; update: <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => void; onNext: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!state.currentPassword) e.currentPassword = "Required";
    if (!state.password) e.password = "Required";
    else if (state.password.length < 8) e.password = "Min 8 characters";
    if (state.password !== state.confirmPassword) e.confirmPassword = "Passwords do not match";
    return e;
  };

  const handleNext = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    setApiError("");
    try {
      await apiClient.post("/onboard/change-password", {
        currentPassword: state.currentPassword,
        newPassword: state.password,
      });
      onNext();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      if (axiosErr.response?.data?.error === "incorrect_password") {
        setApiError("Current password is incorrect");
      } else {
        setApiError("Failed to change password");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle title="🔐 Set Your Password" subtitle="You've been given a temporary password by your admin. Please set a new one now." />
        <div>
          <label className={labelCls}>Current Password</label>
          <input type="password" value={state.currentPassword} onChange={(e) => update("currentPassword", e.target.value)} placeholder="Enter current password" className={inputCls} />
          <FieldError message={errors.currentPassword || apiError} />
        </div>
        <div><label className={labelCls}>New Password</label><input type="password" value={state.password} onChange={(e) => update("password", e.target.value)} placeholder="Min 8 characters" className={inputCls} /><FieldError message={errors.password} /></div>
        <div><label className={labelCls}>Confirm Password</label><input type="password" value={state.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} placeholder="Repeat your password" className={inputCls} /><FieldError message={errors.confirmPassword} /></div>
      </div>
      <BottomBar onNext={handleNext} nextLabel={loading ? "Saving..." : "Continue →"} nextDisabled={loading} showBack={false} />
    </>
  );
}

// ---- Step 2: Schedule (shared) ----
function Step2({ state, update, onBack, onNext }: { state: OnboardingState; update: <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => void; onBack?: () => void; onNext: () => void }) {
  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle title="⏰ Your Brief Schedule" subtitle="When should your daily portfolio brief run?" />
        <div><label className={labelCls}>Daily Brief Time</label><input type="time" value={state.dailyBriefTime} onChange={(e) => update("dailyBriefTime", e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Weekly Research Day</label><select value={state.weeklyResearchDay} onChange={(e) => update("weeklyResearchDay", e.target.value)} className={inputCls}>{DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
        <div><label className={labelCls}>Weekly Research Time</label><input type="time" value={state.weeklyResearchTime} onChange={(e) => update("weeklyResearchTime", e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Timezone</label><select value={state.timezone} onChange={(e) => update("timezone", e.target.value)} className={inputCls}>{TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}</select></div>
        <p className="text-[10px] text-[var(--color-fg-subtle)]">All times in your selected timezone. Daily briefs run on weekdays only.</p>
      </div>
      <BottomBar onBack={onBack} onNext={onNext} />
    </>
  );
}

// ---- Step 3: Telegram (shared) ----
function Step3({ state, update, onBack, onNext }: { state: OnboardingState; update: <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => void; onBack?: () => void; onNext: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const showToast = useToastStore((s) => s.show);

  const handleConnect = async () => {
    if (!state.botToken.trim() || !state.telegramChatId.trim()) {
      setError("Both bot token and chat ID are required");
      return;
    }
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(state.botToken)) {
      setError("Invalid bot token format");
      return;
    }
    if (!/^\d+$/.test(state.telegramChatId)) {
      setError("Invalid chat ID format");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiClient.post("/onboard/telegram", {
        botToken: state.botToken,
        telegramChatId: state.telegramChatId,
      });
      showToast("Telegram connected!", "success");
      onNext();
    } catch {
      setError("Failed to connect Telegram. Check your token and chat ID.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    update("telegramSkip", true);
    onNext();
  };

  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle title="🤖 Connect Telegram (Optional)" subtitle="Get portfolio alerts and interact with your agent via Telegram." />
        <div className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg p-3 text-xs text-[var(--color-fg-muted)] space-y-1">
          <p>1. Open Telegram → find <strong>@BotFather</strong></p>
          <p>2. Send <code className="bg-[var(--color-bg-base)] px-1 rounded">/newbot</code> → follow instructions</p>
          <p>3. Paste your bot token below</p>
        </div>
        <div>
          <label className={labelCls}>Bot Token</label>
          <input type="text" value={state.botToken} onChange={(e) => update("botToken", e.target.value)} placeholder="123456789:ABC-xyz..." className={inputCls} />
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">format: 123456789:ABC-xyz...</p>
        </div>
        <div>
          <label className={labelCls}>Your Chat ID</label>
          <input type="text" value={state.telegramChatId} onChange={(e) => update("telegramChatId", e.target.value.replace(/\D/g, ""))} placeholder="123456789" className={inputCls} />
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">Get from @userinfobot on Telegram</p>
        </div>
        <FieldError message={error} />
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-subtle)] border-t border-[var(--color-border)] p-4 flex gap-3 safe-bottom z-30">
        {onBack && <button onClick={onBack} className="flex-1 py-3 rounded-lg border border-[var(--color-border)] text-sm font-semibold text-[var(--color-fg-muted)]">← Back</button>}
        <button onClick={handleSkip} className="flex-1 py-3 rounded-lg border border-[var(--color-border)] text-sm font-semibold text-[var(--color-fg-muted)]">Skip for now</button>
        <button onClick={handleConnect} disabled={loading} className="flex-1 py-3 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold disabled:opacity-50">
          {loading ? "Connecting..." : "Connect & Continue →"}
        </button>
      </div>
    </>
  );
}

// ---- Position Card ----
function PositionCard({
  pos, idx, accountName, accounts, updateAccount,
}: {
  pos: PositionEntry; idx: number; accountName: string;
  accounts: Account[];
  updateAccount: (id: string, updated: Account) => void;
}) {
  const acc = accounts.find((a) => a.id === accountName)!;
  const updatePos = (patch: Partial<PositionEntry>) => {
    const currency = (patch.exchange
      ? EXCHANGES.find((e) => e.value === patch.exchange)!.currency
      : pos.currency) as Currency;
    updateAccount(accountName, { ...acc, positions: acc.positions.map((p, i) => i === idx ? { ...p, ...patch, currency } : p) });
  };
  const removePos = () => {
    updateAccount(accountName, { ...acc, positions: acc.positions.filter((_, i) => i !== idx) });
  };

  return (
    <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-muted)] rounded-lg p-3 relative">
      <button onClick={removePos} className="absolute top-2 right-2 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-red)]">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      </button>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Ticker</label>
          <input type="text" value={pos.ticker} onChange={(e) => updatePos({ ticker: e.target.value.toUpperCase().slice(0, 10) })} placeholder="AAPL" className={`${inputCls} text-center font-mono font-bold uppercase`} />
        </div>
        <div>
          <label className={labelCls}>Exchange</label>
          <select value={pos.exchange} onChange={(e) => updatePos({ exchange: e.target.value as Exchange })} className={inputCls}>
            {EXCHANGES.map((ex) => <option key={ex.value} value={ex.value}>{ex.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Shares</label>
          <input type="number" value={pos.shares} onChange={(e) => updatePos({ shares: e.target.value })} min="1" step="1" placeholder="100" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Avg Price ({pos.currency})</label>
          <input type="number" value={pos.avgPrice} onChange={(e) => updatePos({ avgPrice: e.target.value })} min="0.01" step="0.01" placeholder="150.00" className={inputCls} />
        </div>
      </div>
    </div>
  );
}

// ---- Account Section ----
function AccountSection({
  account, accounts, updateAccount, deleteAccount, showDelete,
}: {
  account: Account; accounts: Account[];
  updateAccount: (id: string, updated: Account) => void;
  deleteAccount: (id: string) => void;
  showDelete: boolean;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(account.name);

  const commitRename = () => {
    const trimmed = nameVal.trim() || "Account";
    updateAccount(account.id, { ...account, name: trimmed });
    setEditingName(false);
  };

  const addPosition = () => {
    const newPos: PositionEntry = {
      id: generateId(), ticker: "", exchange: "NYSE",
      shares: "", avgPrice: "", currency: "USD", account: account.name,
    };
    updateAccount(account.id, { ...account, positions: [...account.positions, newPos] });
  };

  return (
    <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-muted)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">📁</span>
          {editingName ? (
            <input
              type="text"
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setNameVal(account.name); setEditingName(false); }}}
              className="bg-[var(--color-bg-base)] border border-[var(--color-accent-blue)] rounded px-2 py-0.5 text-sm font-medium text-[var(--color-fg-default)] outline-none w-32"
              autoFocus
            />
          ) : (
            <span className="text-sm font-semibold text-[var(--color-fg-default)] truncate">{account.name}</span>
          )}
          <span className="text-[10px] text-[var(--color-fg-subtle)] bg-[var(--color-bg-base)] px-1.5 py-0.5 rounded">
            {account.positions.length} {account.positions.length === 1 ? "position" : "positions"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setEditingName(true)} className="p-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)]" title="Rename">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          {showDelete && (
            <button onClick={() => deleteAccount(account.id)} className="p-1.5 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-red)]" title="Delete account">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          )}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {account.positions.map((pos, idx) => (
          <PositionCard key={pos.id} pos={pos} idx={idx} accountName={account.id} accounts={accounts} updateAccount={updateAccount} />
        ))}
        <button onClick={addPosition}
          className="w-full py-2 rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-accent-blue)] font-medium">
          + Add Position
        </button>
      </div>
    </div>
  );
}

// ---- Step 4: Portfolio Entry ----
function Step4({
  state, update, onBack, onNext,
}: {
  state: OnboardingState; update: <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => void;
  onBack?: () => void; onNext: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateAccount = (id: string, updated: Account) => {
    update("accounts", state.accounts.map((a) => a.id === id ? updated : a));
  };

  const deleteAccount = (id: string) => {
    if (state.accounts.length <= 1) return;
    update("accounts", state.accounts.filter((a) => a.id !== id));
  };

  const addAccount = () => {
    const existingNames = state.accounts.map((a) => a.name);
    let newName = "New Account";
    let n = 1;
    while (existingNames.includes(newName)) { newName = `Account ${n++}`; }
    const acc: Account = { id: generateId(), name: newName, positions: [] };
    update("accounts", [...state.accounts, acc]);
  };

  const handleNext = () => {
    const e: Record<string, string> = {};
    let hasPositions = false;
    state.accounts.forEach((acc, ai) => {
      acc.positions.forEach((p, pi) => {
        if (!p.ticker.trim()) e[`t_${ai}_${pi}`] = "Ticker required";
        if (!p.shares || Number(p.shares) < 1) e[`s_${ai}_${pi}`] = "Positive integer";
        if (!p.avgPrice || Number(p.avgPrice) < 0.01) e[`p_${ai}_${pi}`] = "Positive number";
        hasPositions = true;
      });
      const seen = new Map<string, number>();
      acc.positions.forEach((p, i) => {
        const key = p.ticker.toUpperCase();
        if (!key) return;
        if (seen.has(key)) { e[`t_${ai}_${seen.get(key)}`] = "Duplicate ticker"; }
        else seen.set(key, i);
      });
    });
    if (!hasPositions) e.positions = "Add at least one position";
    setErrors(e);
    if (Object.keys(e).length === 0) onNext();
  };

  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle title="Portfolio" subtitle="Add your positions across all accounts" />
        {errors.positions && <p className="text-[10px] text-[var(--color-accent-red)]">{errors.positions}</p>}
        {state.accounts.map((account) => (
          <AccountSection
            key={account.id}
            account={account}
            accounts={state.accounts}
            updateAccount={updateAccount}
            deleteAccount={deleteAccount}
            showDelete={state.accounts.length > 1}
          />
        ))}
        <button onClick={addAccount}
          className="w-full py-3 rounded-lg border border-dashed border-[var(--color-border)] text-sm text-[var(--color-accent-blue)] font-medium">
          + Add Account
        </button>
      </div>
      <BottomBar onBack={onBack} onNext={handleNext} nextLabel="Review" showBack={!!onBack} />
    </>
  );
}

// ---- Step 5: Confirm & Launch ----
function Step5({ state }: { state: OnboardingState }) {
  const totalPositions = state.accounts.reduce((sum, a) => sum + a.positions.length, 0);

  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle title="Confirm & Launch" subtitle="Review before launching" />
        <div className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          {state.userId && (
            <div>
              <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">Account</p>
              <p className="text-sm font-semibold text-[var(--color-fg-default)]">{state.displayName || state.userId}</p>
              {state.userId && <p className="text-xs text-[var(--color-fg-muted)]">@{state.userId}</p>}
            </div>
          )}
          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">Schedule</p>
            <p className="text-sm text-[var(--color-fg-default)]">
              Daily at {state.dailyBriefTime} · {DAYS.find((d) => d.value === state.weeklyResearchDay)?.label} at {state.weeklyResearchTime}
            </p>
            <p className="text-xs text-[var(--color-fg-muted)]">{state.timezone}</p>
          </div>
          {state.telegramChatId && (
            <div className="border-t border-[var(--color-border)] pt-3">
              <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">Telegram</p>
              <p className="text-sm text-[var(--color-fg-default)]">✓ Connected</p>
            </div>
          )}
          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">Portfolio</p>
            <p className="text-sm text-[var(--color-fg-default)]">
              {totalPositions} position{totalPositions !== 1 ? "s" : ""} across {state.accounts.length} account{state.accounts.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="border-t border-[var(--color-border)] pt-3 space-y-4">
          {state.accounts.map((acc) => (
            <div key={acc.id}>
              <p className="text-xs font-medium text-[var(--color-fg-muted)] mb-2 flex items-center gap-1.5">
                📁 {acc.name} <span className="text-[10px] opacity-60">({acc.positions.length} {acc.positions.length === 1 ? "position" : "positions"})</span>
              </p>
              <div className="space-y-1.5">
                {acc.positions.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-[var(--color-border-muted)] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[var(--color-fg-default)]">{p.ticker || "—"}</span>
                      <span className="text-[var(--color-fg-subtle)]">{p.exchange}</span>
                    </div>
                    <span className="text-[var(--color-fg-muted)]">{p.shares || "—"} @ {p.avgPrice || "—"} {p.currency}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---- Success ----
// Removed - now redirects immediately to portfolio

// ---- Main Component ----
export function Onboarding() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loginStore = useAuthStore((s) => s.login);
  const showToast = useToastStore((s) => s.show);
  const navigate = useNavigate();

  const [state, setState] = useState<OnboardingState>({
    ...initialState,
    step: isAuthenticated ? 1 : 1,
    accounts: [],
  });

  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const ensureOneAccount = (s: OnboardingState): OnboardingState => {
    if (s.accounts.length === 0) {
      return { ...s, accounts: [{ id: generateId(), name: "Main", positions: [] }] };
    }
    return s;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const accountsPayload: Record<string, Array<{ ticker: string; exchange: string; shares: number; unitAvgBuyPrice: number; unitCurrency: string }>> = {};
      for (const acc of state.accounts) {
        accountsPayload[acc.name] = acc.positions.map((p) => ({
          ticker: p.ticker,
          exchange: p.exchange,
          shares: Number(p.shares),
          unitAvgBuyPrice: Number(p.avgPrice),
          unitCurrency: p.currency,
        }));
      }

      const schedule = {
        dailyBriefTime: state.dailyBriefTime,
        weeklyResearchDay: state.weeklyResearchDay,
        weeklyResearchTime: state.weeklyResearchTime,
        timezone: state.timezone,
      };

      if (isAuthenticated) {
        // Authenticated: portfolio + schedule in body
        await submitPortfolio({
          meta: { currency: "ILS", transactionFeeILS: 0, note: "" },
          accounts: accountsPayload as Record<string, import("../api/onboarding").PortfolioPosition[]>,
          schedule,
        });
      } else {
        // New user: init + login + portfolio
        const initPayload = {
          userId: state.userId,
          password: state.password,
          displayName: state.displayName,
          telegramChatId: state.telegramChatId,
          schedule,
        };
        await submitOnboardInit(initPayload, state.adminKey);
        const loginData = await login(state.userId, state.password);
        loginStore(loginData.token, loginData.userId);
        await submitPortfolio({
          meta: { currency: "ILS", transactionFeeILS: 0, note: "" },
          accounts: accountsPayload as Record<string, import("../api/onboarding").PortfolioPosition[]>,
          schedule,
        });
      }

      // Immediately redirect to portfolio - no success screen
      navigate("/portfolio", { replace: true });
    } catch {
      showToast("Setup failed. Please check your details and try again.", "error");
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[var(--color-bg-base)] min-h-screen flex flex-col">
      <div className="safe-top" />
      <ProgressDots step={state.step} />
      <div className="flex-1 flex flex-col">
        {!isAuthenticated && state.step === 1 && (
          <Step1 state={state} update={update} onNext={() => update("step", 2)} />
        )}
        {isAuthenticated && state.step === 1 && (
          <AuthStep1 state={state} update={update} onNext={() => update("step", 2)} />
        )}
        {state.step === 2 && (
          <Step2
            state={state} update={update}
            onBack={isAuthenticated ? () => update("step", 1) : () => update("step", 1)}
            onNext={() => update("step", 3)}
          />
        )}
        {state.step === 3 && (
          <Step3
            state={state} update={update}
            onBack={() => update("step", 2)}
            onNext={() => update("step", 4)}
          />
        )}
        {state.step === 4 && (
          <Step4
            state={ensureOneAccount(state)}
            update={update}
            onBack={() => update("step", 3)}
            onNext={() => update("step", 5)}
          />
        )}
        {state.step === 5 && (
          <>
            <Step5 state={state} />
            <BottomBar
              onBack={() => update("step", 4)}
              onNext={handleSubmit}
              nextLabel={submitting ? "Launching..." : "Launch My Portfolio Agent 🚀"}
              nextDisabled={submitting}
              showBack={true}
            />
          </>
        )}
      </div>
    </div>
  );
}
