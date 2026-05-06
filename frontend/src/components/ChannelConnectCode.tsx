import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { getChannelBindingCode } from "../api/channels";
import { useToastStore } from "../store/toastStore";

/**
 * Channel connect code widget — Phase 6, task 6.6.
 *
 * Shows a 6-char code the user sends to their Telegram or WhatsApp bot
 * to bind the channel. Used in the Settings page.
 */

export function ChannelConnectCode() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const showToast = useToastStore((s) => s.show);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const data = await getChannelBindingCode();
      setCode(data.code);
      setExpiresAt(data.expiresAt);
    } catch {
      showToast("Failed to generate connect code", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!code) return;
    void navigator.clipboard.writeText(`connect ${code}`);
    showToast("Copied to clipboard", "success");
  };

  const minutesLeft = expiresAt
    ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000))
    : null;

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)" }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--color-fg-default)" }}>
          Connect via code
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-fg-muted)" }}>
          Generate a one-time code and send it to your Telegram or WhatsApp bot.
        </p>
      </div>

      {code ? (
        <div className="space-y-2">
          <div
            className="flex items-center justify-between rounded-lg px-4 py-3"
            style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}
          >
            <span
              className="font-mono text-xl font-bold tracking-widest"
              style={{ color: "var(--color-accent-blue)" }}
            >
              {code}
            </span>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: "var(--color-fg-muted)" }}
              title="Copy"
            >
              <Copy size={16} />
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--color-fg-subtle)" }}>
            Send <code className="font-mono">connect {code}</code> to your bot.
            {minutesLeft !== null && ` Expires in ${minutesLeft} min.`}
          </p>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: "var(--color-fg-muted)" }}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Generate new code
          </button>
        </div>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: "var(--color-accent-blue)",
            color: "#fff",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Generating…" : "Get connect code"}
        </button>
      )}
    </div>
  );
}
