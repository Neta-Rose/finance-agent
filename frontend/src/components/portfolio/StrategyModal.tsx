import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Circle, AlertTriangle } from "lucide-react";
import { fetchStrategy } from "../../api/strategies";
import { triggerJob } from "../../api/jobs";
import { Spinner } from "../ui/Spinner";
import { ErrorState } from "../ui/ErrorState";
import { ActionBadge } from "../design/ActionBadge";
import { StatCell } from "../design/StatCell";
import { ScoreBar } from "../design/HeroStatCard";
import { useToastStore } from "../../store/toastStore";
import { usePreferencesStore } from "../../store/preferencesStore";
import { t, tConfidence } from "../../store/i18n";
import { timeAgo, formatPct } from "../../utils/format";
import { whyToday } from "../../utils/today/whyToday";
import { snippet } from "../../utils/today/classifyAttention";
import { scoreColor } from "../../utils/today/scoreColor";
import type { StrategyRow, AttentionItem, PositionRow, Verdict } from "../../types/api";

interface StrategyModalProps {
  ticker: string | null;
  /** Drives the "Why this fired" section when arrived from an AttentionCard. */
  attentionItem?: AttentionItem | null;
  /** Health score 0..100 for the ScoreHero + StatCell colors. */
  score?: number;
  /** Position used for Today's change and shares stat cells. */
  position?: PositionRow | null;
  onClose: () => void;
  onDeepDive?: (ticker: string) => void;
}

/**
 * Plain-English one-line verdict — used in the ScoreHero next to the score number.
 * No system internals; user-facing only.
 */
const VERDICT_LINE: Record<Verdict, string> = {
  BUY: "Add or initiate.",
  ADD: "Add to position.",
  HOLD: "Hold steady.",
  REDUCE: "Trim the position.",
  SELL: "Reduce or exit.",
  CLOSE: "Close out.",
};

/**
 * Position detail sheet — new layout per design pivot spec section 5.
 * Replaces the old StrategyModal flow when arrived from an AttentionCard.
 */
export function StrategyModal({
  ticker,
  attentionItem,
  score,
  position,
  onClose,
  onDeepDive,
}: StrategyModalProps) {
  const language = usePreferencesStore((s) => s.language);
  const showToast = useToastStore((s) => s.show);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategy", ticker],
    queryFn: () => fetchStrategy(ticker!),
    enabled: !!ticker,
  });

  const handleDeepDive = async () => {
    if (!ticker) return;
    try {
      await triggerJob("deep_dive", ticker);
      await queryClient.invalidateQueries({ queryKey: ["balance"] });
      showToast(`${t("jobDeepDiveTitle", language)} — ${ticker} ${t("jobQueued", language)}`, "success");
      onDeepDive?.(ticker);
    } catch (err) {
      const apiError = err as { response?: { data?: { reason?: string; error?: string } } };
      showToast(apiError.response?.data?.reason ?? t("jobFailed", language), "error");
    }
  };

  if (!ticker) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "var(--bg-base)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "100vh",
          overflow: "hidden",
        }}
      >
        {/* TopBar — back | ticker · exchange | ActionBadge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "0.5px solid var(--bg-border)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={language === "he" ? "חזור" : "Back"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {language === "he" ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "var(--text-md)",
                fontWeight: "var(--weight-bold)",
                color: "var(--text-primary)",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
              }}
            >
              {ticker}
            </div>
            {position && (
              <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
                {position.exchange}
              </div>
            )}
          </div>
          {data && <ActionBadge verdict={data.verdict} score={score} />}
        </div>

        {/* Body — scroll */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {isLoading && (
            <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
              <Spinner size="lg" />
            </div>
          )}
          {error && (
            <ErrorState message={t("failedLoadStrategy", language)} onRetry={() => refetch()} />
          )}
          {data && (
            <DetailContent
              strategy={data}
              attentionItem={attentionItem ?? null}
              score={score}
              position={position ?? null}
              language={language}
            />
          )}
        </div>

        {/* ActionRow — primary Deep Dive | secondary Dismiss */}
        {data && (
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
              borderTop: "0.5px solid var(--bg-border)",
              background: "var(--bg-base)",
              flexShrink: 0,
            }}
          >
            {onDeepDive !== undefined && (
              <button
                type="button"
                onClick={handleDeepDive}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--text-primary)",
                  color: "var(--bg-base)",
                  border: "none",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-bold)",
                  cursor: "pointer",
                }}
              >
                {t("runDeepDive", language)}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: onDeepDive !== undefined ? 0 : 1,
                padding: "12px 16px",
                borderRadius: "var(--radius-md)",
                background: "transparent",
                color: "var(--text-secondary)",
                border: "0.5px solid var(--bg-border)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {language === "he" ? "סגור" : "Dismiss"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailContent({
  strategy,
  attentionItem,
  score,
  position,
  language,
}: {
  strategy: StrategyRow;
  attentionItem: AttentionItem | null;
  score?: number;
  position: PositionRow | null;
  language: "en" | "he";
}) {
  const verdictLine = VERDICT_LINE[strategy.verdict];
  const heroScore = score ?? 0;
  const hasScore = score !== undefined && Number.isFinite(score);

  // Why this fired — prefer the AttentionItem's whyToday; fall back for non-attention drill-downs.
  const whyText = attentionItem
    ? whyToday(attentionItem, language)
    : strategy.reasoning
    ? snippet(strategy.reasoning, 140)
    : null;

  // Rationale — first 2 sentences max, plain language.
  const rationale = twoSentences(strategy.reasoning);

  const dayChangePct = position?.dayChangePct ?? 0;
  const hasDay = dayChangePct !== 0;

  return (
    <div>
      {/* ScoreHero — large number left, verdict line right */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          padding: "20px 16px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: "var(--text-hero)",
              fontWeight: "var(--weight-bold)",
              lineHeight: 1,
              letterSpacing: "-1.5px",
              color: hasScore ? scoreColor(heroScore) : "var(--text-primary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {hasScore ? heroScore : "—"}
          </span>
          <span
            style={{
              fontSize: "var(--text-md)",
              color: "var(--text-tertiary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            / 100
          </span>
        </div>
        <div
          style={{
            textAlign: "end",
            fontSize: "var(--text-md)",
            color: "var(--text-secondary)",
            maxWidth: "55%",
            lineHeight: 1.4,
          }}
        >
          {verdictLine}
        </div>
      </div>

      {/* ScoreBar */}
      {hasScore && (
        <div style={{ paddingBottom: 16 }}>
          <ScoreBar score={heroScore} />
        </div>
      )}

      <Divider />

      {/* 2x2 stats: Weight | Shares | Today | Confidence */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          padding: "12px 16px",
        }}
      >
        <StatCell
          label={language === "he" ? "משקל" : "Weight"}
          value={`${(strategy.positionWeightPct ?? position?.weightPct ?? 0).toFixed(1)}%`}
        />
        <StatCell
          label={language === "he" ? "מניות" : "Shares"}
          value={position?.shares !== undefined ? String(position.shares) : "—"}
        />
        <StatCell
          label={language === "he" ? "היום" : "Today"}
          value={hasDay ? `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%` : "—"}
          positive={hasDay ? dayChangePct > 0 : null}
        />
        <StatCell
          label={language === "he" ? "ביטחון" : "Confidence"}
          value={tConfidence(strategy.confidence, language)}
        />
      </div>

      <Divider />

      {/* Why this fired + tiny metadata */}
      {whyText && (
        <>
          <SectionHeader
            label={language === "he" ? "למה זה עלה" : "Why this fired"}
            meta={`${language === "he" ? "עודכן" : "updated"} ${timeAgo(strategy.updatedAt)}`}
          />
          <p
            style={{
              padding: "0 16px 16px",
              fontSize: "var(--text-md)",
              lineHeight: 1.5,
              color: "var(--text-primary)",
              fontWeight: "var(--weight-regular)",
            }}
          >
            {whyText}
          </p>
        </>
      )}

      {/* Rationale */}
      {rationale && rationale !== whyText && (
        <p
          style={{
            padding: "0 16px 16px",
            fontSize: "var(--text-md)",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            fontWeight: "var(--weight-regular)",
          }}
        >
          {rationale}
        </p>
      )}

      {/* Bull/Bear 2-col */}
      {(strategy.bullCase || strategy.bearCase) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            padding: "0 16px 16px",
          }}
        >
          <BullBearCard
            label={language === "he" ? "בעד" : "Bull"}
            color="var(--color-green)"
            text={strategy.bullCase}
          />
          <BullBearCard
            label={language === "he" ? "נגד" : "Bear"}
            color="var(--color-red)"
            text={strategy.bearCase}
          />
        </div>
      )}

      <Divider />

      {/* Conditions */}
      <SectionHeader
        label={language === "he" ? "תנאים" : "Conditions"}
        meta={`${strategy.entryConditions.length + strategy.exitConditions.length}`}
      />
      <div style={{ padding: "0 16px 24px" }}>
        {strategy.entryConditions.map((c, i) => (
          <ConditionRow
            key={`e-${i}`}
            kind="entry"
            text={c}
            label={language === "he" ? "כניסה" : "ENTRY"}
          />
        ))}
        {strategy.exitConditions.map((c, i) => (
          <ConditionRow
            key={`x-${i}`}
            kind="exit"
            text={c}
            label={language === "he" ? "יציאה" : "EXIT"}
          />
        ))}
        {strategy.entryConditions.length + strategy.exitConditions.length === 0 && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
            {language === "he" ? "אין תנאים מוגדרים" : "No conditions set."}
          </div>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--bg-border)" }} />;
}

function SectionHeader({ label, meta }: { label: string; meta?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "16px 16px 8px",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-2xs)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-tertiary)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      {meta && (
        <span
          style={{
            fontSize: "var(--text-2xs)",
            color: "var(--text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {meta}
        </span>
      )}
    </div>
  );
}

function BullBearCard({ label, color, text }: { label: string; color: string; text: string | null | undefined }) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-md)",
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-bold)",
          color,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          lineHeight: 1.45,
        }}
      >
        {text ?? "—"}
      </div>
    </div>
  );
}

function ConditionRow({ kind, text, label }: { kind: "entry" | "exit"; text: string; label: string }) {
  // v1: no per-condition met/unmet/warn data — render with neutral dot.
  // Phase 2: backend will produce structured condition state; switch icon accordingly.
  const Icon = Circle;
  const dotColor = "var(--text-ghost)";
  // Reserved for Phase 2 — keep imports referenced so they survive future use.
  void Check;
  void AlertTriangle;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 0",
        borderTop: "0.5px solid var(--bg-border)",
      }}
    >
      <Icon size={10} color={dotColor} style={{ marginTop: 4, flexShrink: 0, fill: dotColor }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.4 }}>
          {text}
        </div>
      </div>
      <span
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: 500,
          color: kind === "entry" ? "var(--color-green)" : "var(--color-amber)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Truncate to first ~2 sentences for the rationale section.
 * Plain language only. Caller responsible for stripping system internals upstream.
 */
function twoSentences(text: string | null | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  const joined = parts.slice(0, 2).join(" ");
  if (joined.length <= 280) return joined;
  return joined.slice(0, 280).replace(/\s+\S*$/, "") + "…";
}

/* Used for sign-bug fix in callers that previously did `+${formatPct(...)}` */
export const __SIGN_FIX_NOTE = formatPct;
