import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchTicker } from "../../api/search";
import type { TickerSelection, Exchange } from "../../types/api";

interface TickerSearchProps {
  value: TickerSelection | null;
  onChange: (val: TickerSelection | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

function formatPrice(price: number | null, exchange: Exchange): string | null {
  if (price === null) return null;
  const sym =
    exchange === "TASE" ? "₪" :
    exchange === "LSE" ? "£" :
    (exchange === "XETRA" || exchange === "EURONEXT") ? "€" : "$";
  return `${sym}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function TickerSearch({ value, onChange, placeholder = "Search ticker…", disabled }: TickerSearchProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce query → debouncedQuery
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Click-outside closes dropdown
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["ticker-search", debouncedQuery],
    queryFn: () => searchTicker(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const results = data?.results ?? [];

  // Reset highlight + open dropdown when results arrive
  useEffect(() => {
    setHighlightIdx(-1);
    if (debouncedQuery.length >= 2) setOpen(true);
    else setOpen(false);
  }, [debouncedQuery, results.length]);

  const handleSelect = useCallback((result: TickerSelection) => {
    onChange(result);
    setQuery("");
    setDebouncedQuery("");
    setOpen(false);
    setHighlightIdx(-1);
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && highlightIdx >= 0 && results[highlightIdx]) {
      e.preventDefault();
      handleSelect(results[highlightIdx]!);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setDebouncedQuery("");
    }
  };

  // ── Selected pill ──────────────────────────────────────────────────────────
  if (value) {
    const priceStr = formatPrice(value.price, value.exchange);
    return (
      <div className="flex items-center gap-3 bg-[var(--color-bg-muted)] border border-[var(--color-accent-blue)] rounded-xl p-3">
        <span className="text-2xl leading-none">{value.flag}</span>
        <div className="flex-1 min-w-0">
          <div className="text-base font-extrabold text-[var(--color-fg-default)] leading-tight">{value.symbol}</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {priceStr && (
              <span className="text-sm font-semibold text-[var(--color-accent-green)]">{priceStr}</span>
            )}
            <span className="text-xs text-[var(--color-fg-muted)] flex items-center gap-1">
              <span className="text-sm">{value.flag}</span>{value.exchDisp}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="text-xs text-[var(--color-accent-blue)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 whitespace-nowrap disabled:opacity-40"
        >
          Change ↩
        </button>
      </div>
    );
  }

  // ── Search input + dropdown ────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] pointer-events-none select-none">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (debouncedQuery.length >= 2) setOpen(true); }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] focus:border-[var(--color-accent-blue)] rounded-xl pl-9 pr-8 py-2.5 font-mono font-bold text-[var(--color-fg-default)] outline-none disabled:opacity-40"
          style={{ fontSize: "16px" }}
        />
        {isFetching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] text-xs animate-spin select-none">⏳</span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-2xl">
          {results.length > 0 ? (
            results.map((r, i) => {
              const priceStr = formatPrice(r.price, r.exchange);
              return (
                <button
                  key={r.symbol}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(r); }}
                  className={`w-full flex items-center gap-3 px-3 text-left transition-colors min-h-[48px] ${
                    i < results.length - 1 ? "border-b border-[var(--color-border)]" : ""
                  } ${i === highlightIdx ? "bg-[var(--color-bg-muted)]" : "hover:bg-[var(--color-bg-muted)]"}`}
                >
                  <span className="text-xl leading-none flex-shrink-0">{r.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[var(--color-fg-default)]">{r.symbol}</div>
                    <div className="text-[10px] text-[var(--color-fg-muted)] truncate">{r.shortName}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[10px] text-[var(--color-fg-subtle)] flex items-center gap-1 justify-end">
                      <span className="text-xs">{r.flag}</span>{r.exchDisp}
                    </div>
                    {priceStr && (
                      <div className="text-xs font-semibold text-[var(--color-accent-green)]">{priceStr}</div>
                    )}
                  </div>
                </button>
              );
            })
          ) : !isFetching ? (
            <div className="px-3 py-3 text-xs text-[var(--color-fg-muted)]">
              No results for &ldquo;{debouncedQuery}&rdquo;
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
