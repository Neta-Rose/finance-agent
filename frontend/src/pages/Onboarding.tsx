import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useToastStore } from "../store/toastStore";
import { submitOnboardInit, submitPortfolio } from "../api/onboarding";
import { login } from "../api/auth";
import { type PositionEntry } from "../api/onboarding";

interface OnboardingState {
  step: 1 | 2 | 3 | 4;
  adminKey: string;
  userId: string;
  password: string;
  confirmPassword: string;
  displayName: string;
  telegramChatId: string;
  dailyBriefTime: string;
  weeklyResearchDay: string;
  weeklyResearchTime: string;
  timezone: string;
  positions: PositionEntry[];
  hasSecondAccount: boolean;
}

const initialState: OnboardingState = {
  step: 1,
  adminKey: "",
  userId: "",
  password: "",
  confirmPassword: "",
  displayName: "",
  telegramChatId: "",
  dailyBriefTime: "08:00",
  weeklyResearchDay: "sunday",
  weeklyResearchTime: "19:00",
  timezone: "Asia/Jerusalem",
  positions: [],
  hasSecondAccount: false,
};

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

const inputCls = "w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)] appearance-none";
const labelCls = "text-xs font-medium text-[var(--color-fg-muted)] mb-1.5 block";
const helperCls = "text-[10px] text-[var(--color-fg-subtle)] mt-1";
const errorCls = "text-[10px] text-[var(--color-accent-red)] mt-1";

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {[1, 2, 3, 4].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              s < step
                ? "bg-[var(--color-accent-green)] text-white"
                : s === step
                ? "bg-[var(--color-accent-blue)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-fg-subtle)]"
            }`}
          >
            {s < step ? "✓" : s}
          </div>
          {s < 4 && (
            <div className={`w-6 h-0.5 ${s < step ? "bg-[var(--color-accent-green)]" : "bg-[var(--color-border)]"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function BottomBar({
  onBack,
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  showBack = true,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showBack?: boolean;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-subtle)] border-t border-[var(--color-border)] p-4 flex gap-3 safe-bottom z-30">
      {showBack ? (
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-lg border border-[var(--color-border)] text-sm font-semibold text-[var(--color-fg-muted)]"
        >
          Back
        </button>
      ) : (
        <div className="flex-1" />
      )}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="flex-1 py-3 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold disabled:opacity-50"
      >
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

// ---- Step 1 ----
function Step1({
  state,
  update,
  onNext,
}: {
  state: OnboardingState;
  update: <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => void;
  onNext: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!state.adminKey.trim()) e.adminKey = "Required";
    if (!state.userId.trim()) e.userId = "Required";
    else if (!/^[a-zA-Z0-9-]{4,32}$/.test(state.userId)) e.userId = "4-32 alphanumeric characters or hyphens";
    if (!state.password) e.password = "Required";
    else if (state.password.length < 8) e.password = "Minimum 8 characters";
    if (state.password !== state.confirmPassword) e.confirmPassword = "Passwords do not match";
    if (!state.displayName.trim()) e.displayName = "Required";
    if (!state.telegramChatId.trim()) e.telegramChatId = "Required";
    else if (!/^\d+$/.test(state.telegramChatId)) e.telegramChatId = "Numbers only";
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
        <StepTitle
          title="Account Setup"
          subtitle="Create your portfolio agent account"
        />

        <div>
          <label className={labelCls}>Beta Access Code</label>
          <input
            type="text"
            value={state.adminKey}
            onChange={(e) => update("adminKey", e.target.value)}
            placeholder="Enter your beta access code"
            className={inputCls}
          />
          <FieldError message={errors.adminKey} />
        </div>

        <div>
          <label className={labelCls}>User ID</label>
          <input
            type="text"
            value={state.userId}
            onChange={(e) => update("userId", e.target.value.toLowerCase().replace(/[^a-zA-Z0-9-]/g, ""))}
            placeholder="john-doe"
            maxLength={32}
            className={inputCls}
          />
          <p className={helperCls}>This is your login identifier. Cannot be changed later.</p>
          <FieldError message={errors.userId} />
        </div>

        <div>
          <label className={labelCls}>Password</label>
          <input
            type="password"
            value={state.password}
            onChange={(e) => update("password", e.target.value)}
            placeholder="Min 8 characters"
            className={inputCls}
          />
          <FieldError message={errors.password} />
        </div>

        <div>
          <label className={labelCls}>Confirm Password</label>
          <input
            type="password"
            value={state.confirmPassword}
            onChange={(e) => update("confirmPassword", e.target.value)}
            placeholder="Repeat your password"
            className={inputCls}
          />
          <FieldError message={errors.confirmPassword} />
        </div>

        <div>
          <label className={labelCls}>Display Name</label>
          <input
            type="text"
            value={state.displayName}
            onChange={(e) => update("displayName", e.target.value)}
            placeholder="How should we call you?"
            className={inputCls}
          />
          <FieldError message={errors.displayName} />
        </div>

        <div>
          <label className={labelCls}>Telegram Chat ID</label>
          <input
            type="text"
            value={state.telegramChatId}
            onChange={(e) => update("telegramChatId", e.target.value.replace(/\D/g, ""))}
            placeholder="123456789"
            className={inputCls}
          />
          <p className={helperCls}>Get this from @userinfobot on Telegram</p>
          <FieldError message={errors.telegramChatId} />
        </div>
      </div>

      <BottomBar onNext={handleNext} nextLabel="Next" showBack={false} />
    </>
  );
}

// ---- Step 2 ----
function Step2({
  state,
  update,
  onBack,
  onNext,
}: {
  state: OnboardingState;
  update: <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle
          title="Schedule"
          subtitle="When should your reports run?"
        />

        <div>
          <label className={labelCls}>Daily Brief Time</label>
          <input
            type="time"
            value={state.dailyBriefTime}
            onChange={(e) => update("dailyBriefTime", e.target.value)}
            className={inputCls}
          />
          <p className={helperCls}>When should your daily brief run?</p>
        </div>

        <div>
          <label className={labelCls}>Weekly Research Day</label>
          <select
            value={state.weeklyResearchDay}
            onChange={(e) => update("weeklyResearchDay", e.target.value)}
            className={inputCls}
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Weekly Research Time</label>
          <input
            type="time"
            value={state.weeklyResearchTime}
            onChange={(e) => update("weeklyResearchTime", e.target.value)}
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Timezone</label>
          <select
            value={state.timezone}
            onChange={(e) => update("timezone", e.target.value)}
            className={inputCls}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>

        <p className={helperCls}>All times are in your selected timezone. Daily briefs run on weekdays only.</p>
      </div>

      <BottomBar onBack={onBack} onNext={onNext} nextLabel="Next" />
    </>
  );
}

// ---- Step 3 ----
function Step3({
  state,
  update,
  onBack,
  onNext,
  showToast,
}: {
  state: OnboardingState;
  update: <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => void;
  onBack: () => void;
  onNext: () => void;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const addPosition = () => {
    const p: PositionEntry = {
      id: crypto.randomUUID(),
      ticker: "",
      exchange: "NYSE",
      shares: "",
      avgPrice: "",
      currency: "USD",
      account: "main",
    };
    update("positions", [...state.positions, p]);
  };

  const updatePosition = (id: string, patch: Partial<PositionEntry>) => {
    update(
      "positions",
      state.positions.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  };

  const removePosition = (id: string) => {
    update("positions", state.positions.filter((p) => p.id !== id));
  };

  const handleNext = () => {
    const e: Record<string, string> = {};
    if (state.positions.length === 0) {
      e.positions = "Add at least one position";
    } else {
      state.positions.forEach((p, i) => {
        if (!p.ticker.trim()) e[`ticker_${i}`] = "Required";
        if (!p.shares || Number(p.shares) < 1) e[`shares_${i}`] = "Must be positive integer";
        if (!p.avgPrice || Number(p.avgPrice) < 0.01) e[`avgPrice_${i}`] = "Must be positive number";
      });

      // Duplicate check
      const seen = new Map<string, number>();
      state.positions.forEach((p) => {
        const key = `${p.account}:${p.ticker.toUpperCase()}`;
        if (seen.has(key)) {
          e[`ticker_${seen.get(key)}`] = "Duplicate ticker in same account";
        } else {
          seen.set(key, state.positions.indexOf(p));
        }
      });
    }
    setErrors(e);
    if (Object.keys(e).length === 0) onNext();
  };

  const handlePrefill = () => {
    showToast("Portfolio pre-fill coming soon", "info");
  };

  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle
          title="Portfolio"
          subtitle="Add your positions"
        />

        <div>
          <button
            onClick={handlePrefill}
            className="w-full py-2.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-fg-muted)] font-medium"
          >
            Load my current portfolio
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
          <span className="text-xs font-medium text-[var(--color-fg-default)]">Second brokerage account?</span>
          <button
            onClick={() => update("hasSecondAccount", !state.hasSecondAccount)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              state.hasSecondAccount ? "bg-[var(--color-accent-blue)]" : "bg-[var(--color-border)]"
            }`}
          >
            <div
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                state.hasSecondAccount ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div className="space-y-3">
          {state.positions.map((p) => (
            <div
              key={p.id}
              className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg p-3 relative"
            >
              <button
                onClick={() => removePosition(p.id)}
                className="absolute top-2 right-2 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-red)]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                </svg>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Ticker</label>
                  <input
                    type="text"
                    value={p.ticker}
                    onChange={(e) => updatePosition(p.id, { ticker: e.target.value.toUpperCase().slice(0, 10) })}
                    placeholder="AAPL"
                    className={`${inputCls} text-center font-mono font-bold uppercase`}
                  />
                  <FieldError message={errors[`ticker_${state.positions.indexOf(p)}`] ?? ""} />
                </div>

                <div>
                  <label className={labelCls}>Exchange</label>
                  <select
                    value={p.exchange}
                    onChange={(e) => {
                      const ex = e.target.value as "NYSE" | "NASDAQ" | "TASE";
                      updatePosition(p.id, {
                        exchange: ex,
                        currency: ex === "TASE" ? "ILA" : "USD",
                      });
                    }}
                    className={inputCls}
                  >
                    <option value="NYSE">NYSE</option>
                    <option value="NASDAQ">NASDAQ</option>
                    <option value="TASE">TASE</option>
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Shares</label>
                  <input
                    type="number"
                    value={p.shares}
                    onChange={(e) => updatePosition(p.id, { shares: e.target.value })}
                    min="1"
                    step="1"
                    placeholder="100"
                    className={inputCls}
                  />
                  <FieldError message={errors[`shares_${state.positions.indexOf(p)}`] ?? ""} />
                </div>

                <div>
                  <label className={labelCls}>
                    Avg Price ({p.currency === "USD" ? "USD" : "Agorot"})
                  </label>
                  <input
                    type="number"
                    value={p.avgPrice}
                    onChange={(e) => updatePosition(p.id, { avgPrice: e.target.value })}
                    min="0.01"
                    step="0.01"
                    placeholder={p.currency === "USD" ? "150.00" : "365"}
                    className={inputCls}
                  />
                  <FieldError message={errors[`avgPrice_${state.positions.indexOf(p)}`] ?? ""} />
                </div>

                {state.hasSecondAccount && (
                  <div className="col-span-2">
                    <label className={labelCls}>Account</label>
                    <div className="flex gap-2">
                      {(["main", "second"] as const).map((acc) => (
                        <button
                          key={acc}
                          onClick={() => updatePosition(p.id, { account: acc })}
                          className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                            p.account === acc
                              ? "bg-[var(--color-accent-blue)] text-white border-[var(--color-accent-blue)]"
                              : "border-[var(--color-border)] text-[var(--color-fg-muted)]"
                          }`}
                        >
                          {acc === "main" ? "Main" : "Second"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {errors.positions && <p className={errorCls}>{errors.positions}</p>}

        <button
          onClick={addPosition}
          className="w-full py-3 rounded-lg border border-dashed border-[var(--color-border)] text-sm text-[var(--color-accent-blue)] font-medium"
        >
          + Add Position
        </button>
      </div>

      <BottomBar onBack={onBack} onNext={handleNext} nextLabel="Review" />
    </>
  );
}

// ---- Step 4 ----
function Step4({
  state,
  onBack,
  onSubmit,
  submitting,
}: {
  state: OnboardingState;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const accountCount = state.hasSecondAccount ? 2 : 1;
  const totalPositions = state.positions.length;

  return (
    <>
      <div className="px-4 space-y-4 flex-1 overflow-y-auto pb-36">
        <StepTitle
          title="Confirm & Launch"
          subtitle="Review your setup before launching"
        />

        <div className="bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div>
            <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">Account</p>
            <p className="text-sm font-semibold text-[var(--color-fg-default)]">{state.displayName}</p>
            <p className="text-xs text-[var(--color-fg-muted)]">@{state.userId}</p>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">Schedule</p>
            <p className="text-sm text-[var(--color-fg-default)]">
              Daily brief at {state.dailyBriefTime} · {DAYS.find((d) => d.value === state.weeklyResearchDay)?.label} at {state.weeklyResearchTime}
            </p>
            <p className="text-xs text-[var(--color-fg-muted)]">{state.timezone}</p>
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-[10px] text-[var(--color-fg-subtle)] uppercase font-medium">Portfolio</p>
            <p className="text-sm text-[var(--color-fg-default)]">
              {totalPositions} position{totalPositions !== 1 ? "s" : ""} across {accountCount} account{accountCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="text-xs font-medium text-[var(--color-fg-muted)] mb-2">Positions</p>
          <div className="space-y-2">
            {state.positions.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-[var(--color-border-muted)] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[var(--color-fg-default)]">{p.ticker || "—"}</span>
                  <span className="text-[var(--color-fg-subtle)]">{p.exchange}</span>
                  {state.hasSecondAccount && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-muted)] text-[var(--color-fg-subtle)]">
                      {p.account}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[var(--color-fg-default)]">{p.shares || "—"} @ {p.avgPrice || "—"} {p.currency}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <BottomBar
        onBack={onBack}
        onNext={onSubmit}
        nextLabel={submitting ? "Launching..." : "Launch My Portfolio Agent 🚀"}
        nextDisabled={submitting}
      />
    </>
  );
}

// ---- Success ----
function Success({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 text-center">
      <div className="text-6xl mb-4">✅</div>
      <h2 className="text-xl font-bold text-[var(--color-fg-default)] mb-2">Portfolio Agent Activated</h2>
      <p className="text-sm text-[var(--color-fg-muted)] mb-8 max-w-xs">
        Your full portfolio analysis is running. You'll receive a Telegram message when it's ready.
      </p>
      <button
        onClick={onNavigate}
        className="px-6 py-3 rounded-lg bg-[var(--color-accent-blue)] text-white text-sm font-semibold"
      >
        Go to Dashboard →
      </button>
    </div>
  );
}

// ---- Main Component ----
export function Onboarding() {
  const [state, setState] = useState<OnboardingState>(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const loginStore = useAuthStore((s) => s.login);
  const showToast = useToastStore((s) => s.show);

  const update = <K extends keyof OnboardingState>(k: K, v: OnboardingState[K]) => {
    setState((s) => ({ ...s, [k]: v }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const initPayload = {
        userId: state.userId,
        password: state.password,
        displayName: state.displayName,
        telegramChatId: state.telegramChatId,
        schedule: {
          dailyBriefTime: state.dailyBriefTime,
          weeklyResearchDay: state.weeklyResearchDay,
          weeklyResearchTime: state.weeklyResearchTime,
          timezone: state.timezone,
        },
      };

      await submitOnboardInit(initPayload, state.adminKey);

      const loginData = await login(state.userId, state.password);
      loginStore(loginData.token, loginData.userId);

      const mainPositions = state.positions
        .filter((p) => p.account === "main")
        .map((p) => ({
          ticker: p.ticker,
          exchange: p.exchange,
          shares: Number(p.shares),
          unitAvgBuyPrice: Number(p.avgPrice),
          unitCurrency: p.currency as "USD" | "ILA",
        }));

      const secondPositions = state.hasSecondAccount
        ? state.positions
            .filter((p) => p.account === "second")
            .map((p) => ({
              ticker: p.ticker,
              exchange: p.exchange,
              shares: Number(p.shares),
              unitAvgBuyPrice: Number(p.avgPrice),
              unitCurrency: p.currency as "USD" | "ILA",
            }))
        : undefined;

      await submitPortfolio({
        meta: { currency: "USD", transactionFeeILS: 0, note: "" },
        accounts: {
          main: mainPositions,
          ...(secondPositions ? { second: secondPositions } : {}),
        },
      });

      setSuccess(true);
      setTimeout(() => navigate("/portfolio", { replace: true }), 2000);
    } catch (err) {
      showToast("Setup failed. Please check your details and try again.", "error");
      setSubmitting(false);
    }
  };

  if (success) {
    return <Success onNavigate={() => navigate("/portfolio", { replace: true })} />;
  }

  return (
    <div className="bg-[var(--color-bg-base)] min-h-screen flex flex-col">
      <div className="safe-top" />
      <ProgressDots step={state.step} />

      <div className="flex-1 flex flex-col">
        {state.step === 1 && (
          <Step1 state={state} update={update} onNext={() => update("step", 2)} />
        )}
        {state.step === 2 && (
          <Step2
            state={state}
            update={update}
            onBack={() => update("step", 1)}
            onNext={() => update("step", 3)}
          />
        )}
        {state.step === 3 && (
          <Step3
            state={state}
            update={update}
            onBack={() => update("step", 2)}
            onNext={() => update("step", 4)}
            showToast={showToast}
          />
        )}
        {state.step === 4 && (
          <Step4
            state={state}
            onBack={() => update("step", 3)}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}
