# Ticker Search + Add Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live ticker search dropdown (used everywhere a ticker is entered) and a functional Add Position modal on the Portfolio page that detects clashes and auto-queues deep dives.

**Architecture:** New `GET /api/search/ticker` backend route wraps yahoo-finance2 search + parallel price fetch. New `POST /api/portfolio/position` route appends positions. Frontend `TickerSearch` is a controlled component used in AddPositionModal, Controls deep dive card, and Onboarding PositionCard.

**Tech Stack:** Node/Express/TypeScript (backend), React 18 + React Query + Tailwind v4 (frontend), yahoo-finance2 v3.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `backend/src/routes/search.ts` | `GET /api/search/ticker` — search + price batch |
| Modify | `backend/src/app.ts` | register search route |
| Modify | `backend/src/routes/portfolio.ts` | add `accounts[]` to GET response; add `POST /portfolio/position` |
| Modify | `frontend/src/types/api.ts` | add `TickerSelection`, `SearchResponse`, `accounts` field on `PortfolioResponse` |
| Create | `frontend/src/api/search.ts` | `searchTicker(q)` API call |
| Modify | `frontend/src/api/portfolio.ts` | add `addPosition()` |
| Create | `frontend/src/components/ui/TickerSearch.tsx` | reusable search input + pill |
| Create | `frontend/src/components/portfolio/AddPositionModal.tsx` | bottom-sheet modal with clash + deep-dive logic |
| Modify | `frontend/src/pages/Portfolio.tsx` | wire Add Position button → modal |
| Modify | `frontend/src/pages/Controls.tsx` | replace text input with `TickerSearch` in deep dive card |
| Modify | `frontend/src/pages/Onboarding.tsx` | replace text input with `TickerSearch` in PositionCard |

---

## Task 1: Backend — Ticker Search Route

**Files:**
- Create: `backend/src/routes/search.ts`
- Modify: `backend/src/app.ts:60-69`

- [ ] **Step 1: Create `backend/src/routes/search.ts`**

```typescript
import { Router, type Request, type Response, type NextFunction } from "express";
import YahooFinance from "yahoo-finance2";
import type { Exchange } from "../types/index.js";

const router = Router();
const yf = new YahooFinance();

const CACHE_TTL = 30_000;
const searchCache = new Map<string, { results: SearchResult[]; ts: number }>();

export interface SearchResult {
  symbol: string;
  shortName: string;
  exchange: Exchange;
  exchDisp: string;
  flag: string;
  price: number | null;
  currency: string;
}

const EXCHANGE_MAP: Record<string, Exchange> = {
  NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ",
  NYQ: "NYSE",  NYS: "NYSE",
  TLV: "TASE",
  LSE: "LSE",   IOB: "LSE",
  GER: "XETRA", EBS: "XETRA",
  PAR: "EURONEXT", AMS: "EURONEXT", BRU: "EURONEXT", LIS: "EURONEXT",
};

const FLAG_MAP: Record<Exchange, string> = {
  NASDAQ:   "🇺🇸",
  NYSE:     "🇺🇸",
  TASE:     "🇮🇱",
  LSE:      "🇬🇧",
  XETRA:    "🇩🇪",
  EURONEXT: "🇪🇺",
  OTHER:    "🌐",
};

function mapExchange(yahooCode: string): Exchange {
  return EXCHANGE_MAP[yahooCode] ?? "OTHER";
}

router.get(
  "/search/ticker",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = String(req.query["q"] ?? "").trim().toUpperCase();
      if (q.length < 2) {
        res.json({ results: [] });
        return;
      }

      const cached = searchCache.get(q);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        res.json({ results: cached.results });
        return;
      }

      let quotes: Array<{
        symbol: string;
        shortname?: string;
        longname?: string;
        exchange?: string;
        exchDisp?: string;
        quoteType?: string;
      }> = [];

      try {
        const searchRes = await yf.search(q, {
          quotesCount: 6,
          newsCount: 0,
          enableFuzzyQuery: false,
        } as Parameters<typeof yf.search>[1]);
        quotes = ((searchRes.quotes ?? []) as typeof quotes).filter(
          (r) => r.quoteType === "EQUITY"
        );
      } catch {
        res.json({ results: [] });
        return;
      }

      const priceResults = await Promise.allSettled(
        quotes.map((q) => yf.quote(q.symbol))
      );

      const results: SearchResult[] = quotes.map((q, i) => {
        const exchange = mapExchange(q.exchange ?? "");
        const pr = priceResults[i];
        let price: number | null = null;
        let currency = "USD";

        if (pr.status === "fulfilled") {
          const raw = (pr.value as { regularMarketPrice?: number; currency?: string }).regularMarketPrice ?? null;
          currency = (pr.value as { regularMarketPrice?: number; currency?: string }).currency ?? "USD";
          if (raw !== null && raw !== undefined) {
            price = exchange === "TASE" ? raw / 100 : raw;
          }
        }

        return {
          symbol: q.symbol,
          shortName: q.longname ?? q.shortname ?? q.symbol,
          exchange,
          exchDisp: q.exchDisp ?? exchange,
          flag: FLAG_MAP[exchange],
          price,
          currency: exchange === "TASE" ? "ILS" : currency,
        };
      });

      searchCache.set(q, { results, ts: Date.now() });
      res.json({ results });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
```

- [ ] **Step 2: Register the route in `backend/src/app.ts`**

Add import after line 25 (after existing route imports):
```typescript
import searchRoutes from "./routes/search.js";
```

Add mount after line 65 (after `app.use("/api", strategyRoutes)`):
```typescript
app.use("/api", searchRoutes); // GET /api/search/ticker — no user workspace needed
```

Note: the search route uses JWT auth (inherited from `app.use("/api", authMiddleware, userIsolationMiddleware)` at line 60) but does NOT use `res.locals.workspace` — that is fine, the middleware still runs.

- [ ] **Step 3: Start the dev server and verify the route**

```bash
cd /root/clawd/backend && npx tsx src/server.ts &
# Wait a few seconds, then get a JWT first:
TOKEN=$(curl -s -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId":"<your-test-user>","password":"<password>"}' | jq -r .token)

curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8081/api/search/ticker?q=AAPL" | jq .
```

Expected: `{ "results": [ { "symbol": "AAPL", "shortName": "Apple Inc.", "exchange": "NASDAQ", "flag": "🇺🇸", "price": <number>, ... }, ... ] }`

Short query test:
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8081/api/search/ticker?q=A" | jq .
```
Expected: `{ "results": [] }`

- [ ] **Step 4: Kill the dev server**

```bash
kill %1 2>/dev/null; true
```

- [ ] **Step 5: Commit**

```bash
cd /root/clawd
git add backend/src/routes/search.ts backend/src/app.ts
git commit -m "feat: add GET /api/search/ticker route with yahoo-finance2 search + price batch"
```

---

## Task 2: Backend — Portfolio Route Updates

**Files:**
- Modify: `backend/src/routes/portfolio.ts`

Two changes: (1) add `accounts: string[]` to the `GET /api/portfolio` response, (2) add `POST /api/portfolio/position`.

- [ ] **Step 1: Add `accounts` to the `PortfolioResponse` interface and GET response**

In `backend/src/routes/portfolio.ts`, update the `PortfolioResponse` interface (lines 23-31):
```typescript
interface PortfolioResponse {
  updatedAt: string;
  usdIlsRate: number;
  totalILS: number;
  totalCostILS: number;
  totalPlILS: number;
  totalPlPct: number;
  accounts: string[];      // ← add this
  positions: PositionRow[];
}
```

Update the response object (around line 170, where `response` is built):
```typescript
const response: PortfolioResponse = {
  updatedAt: new Date().toISOString(),
  usdIlsRate,
  totalILS: Math.round(totalILS * 100) / 100,
  totalCostILS: Math.round(totalCostILS * 100) / 100,
  totalPlILS: Math.round(totalPlILS * 100) / 100,
  totalPlPct: Math.round(totalPlPct * 100) / 100,
  accounts: Object.keys(portfolio.accounts),   // ← add this
  positions,
};
```

Also update the empty-state early return (around line 55) to include `accounts: []`:
```typescript
res.json({
  updatedAt: new Date().toISOString(),
  usdIlsRate: 0,
  totalILS: 0,
  totalCostILS: 0,
  totalPlILS: 0,
  totalPlPct: 0,
  accounts: [],       // ← add this
  positions: [],
});
```

- [ ] **Step 2: Add `POST /api/portfolio/position` route**

Add this after the existing `PATCH /position/:ticker` handler (after line 236 in portfolio.ts):

```typescript
// POST /portfolio/position — add a new position
router.post(
  "/portfolio/position",
  handler(async (req: AuthenticatedRequest, res: Response) => {
    const ws = res.locals["workspace"] as UserWorkspace;
    const { ticker, exchange, shares, unitAvgBuyPrice, unitCurrency, account, force } =
      req.body as {
        ticker?: string;
        exchange?: string;
        shares?: number;
        unitAvgBuyPrice?: number;
        unitCurrency?: string;
        account?: string;
        force?: boolean;
      };

    let raw: string;
    try {
      raw = await fs.readFile(ws.portfolioFile, "utf-8");
    } catch {
      res.status(404).json({ error: "portfolio not found" });
      return;
    }

    const portfolio = PortfolioFileSchema.parse(JSON.parse(raw));

    if (!account || !portfolio.accounts[account]) {
      res.status(400).json({ error: "account_not_found" });
      return;
    }

    // Clash check — can be bypassed with force:true (user explicitly chose to add anyway)
    if (!force) {
      const clashAccounts: string[] = [];
      for (const [accName, positions] of Object.entries(portfolio.accounts)) {
        if (positions.some((p) => p.ticker === String(ticker ?? "").toUpperCase())) {
          clashAccounts.push(accName);
        }
      }
      if (clashAccounts.length > 0) {
        res.status(409).json({ clash: true, existingAccounts: clashAccounts });
        return;
      }
    }

    // Validate and append (PortfolioPositionSchema already imported at top of file)
    const newPos = PortfolioPositionSchema.parse({
      ticker: String(ticker ?? "").toUpperCase(),
      exchange,
      shares,
      unitAvgBuyPrice,
      unitCurrency,
    });

    portfolio.accounts[account].push(newPos);
    await fs.writeFile(ws.portfolioFile, JSON.stringify(portfolio, null, 2), "utf-8");
    res.status(201).json({ success: true });
  })
);
```

**Note on `force`:** when the user dismisses the clash warning and proceeds, the frontend sends `{ force: true }` in the request body to bypass this check.

- [ ] **Step 3: Start the dev server and verify**

```bash
cd /root/clawd/backend && npx tsx src/server.ts &
TOKEN=$(curl -s -X POST http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId":"<user>","password":"<pass>"}' | jq -r .token)

# Verify accounts field in portfolio response
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8081/api/portfolio | jq '.accounts'
# Expected: ["Main"] (or whatever accounts this user has)

# Test POST position (will 409 if ticker exists, or 201 if new)
curl -s -X POST http://localhost:8081/api/portfolio/position \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"TSTZ","exchange":"TASE","shares":100,"unitAvgBuyPrice":500,"unitCurrency":"ILA","account":"Main","force":false}' | jq .
# Expected: 201 {"success":true} if TSTZ not already in portfolio
kill %1 2>/dev/null; true
```

- [ ] **Step 4: Commit**

```bash
cd /root/clawd
git add backend/src/routes/portfolio.ts
git commit -m "feat: add accounts[] to portfolio response and POST /portfolio/position route"
```

---

## Task 3: Frontend Types + Search API Client

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/api/search.ts`
- Modify: `frontend/src/api/portfolio.ts`

- [ ] **Step 1: Add `TickerSelection`, `SearchResponse`, and `accounts` field to `frontend/src/types/api.ts`**

Add after the `Exchange` type line (line 3):
```typescript
export interface TickerSelection {
  symbol: string;
  shortName: string;
  exchange: Exchange;
  exchDisp: string;
  flag: string;
  price: number | null;
  currency: string;
}

export interface SearchResponse {
  results: TickerSelection[];
}
```

Add `accounts: string[]` to the `PortfolioResponse` interface (around line 25):
```typescript
export interface PortfolioResponse {
  updatedAt: string;
  usdIlsRate: number;
  totalILS: number;
  totalCostILS: number;
  totalPlILS: number;
  totalPlPct: number;
  accounts: string[];   // ← add this
  positions: PositionRow[];
}
```

- [ ] **Step 2: Create `frontend/src/api/search.ts`**

```typescript
import { apiClient } from "./client";
import type { SearchResponse } from "../types/api";

export const searchTicker = async (q: string): Promise<SearchResponse> =>
  (await apiClient.get<SearchResponse>(`/search/ticker?q=${encodeURIComponent(q)}`)).data;
```

- [ ] **Step 3: Add `addPosition` to `frontend/src/api/portfolio.ts`**

Add at the bottom of the file:
```typescript
export interface AddPositionPayload {
  ticker: string;
  exchange: string;
  shares: number;
  unitAvgBuyPrice: number;
  unitCurrency: "USD" | "ILA" | "GBP" | "EUR";
  account: string;
  force: boolean;
}

export const addPosition = async (payload: AddPositionPayload): Promise<void> => {
  await apiClient.post("/portfolio/position", payload);
};
```

- [ ] **Step 4: Commit**

```bash
cd /root/clawd
git add frontend/src/types/api.ts frontend/src/api/search.ts frontend/src/api/portfolio.ts
git commit -m "feat: add TickerSelection types, SearchResponse, addPosition API, accounts field"
```

---

## Task 4: TickerSearch Component

**Files:**
- Create: `frontend/src/components/ui/TickerSearch.tsx`

- [ ] **Step 1: Create `frontend/src/components/ui/TickerSearch.tsx`**

```tsx
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
              No results for "{debouncedQuery}"
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /root/clawd
git add frontend/src/components/ui/TickerSearch.tsx
git commit -m "feat: TickerSearch component — live search dropdown with flag, exchange, price"
```

---

## Task 5: AddPositionModal Component

**Files:**
- Create: `frontend/src/components/portfolio/AddPositionModal.tsx`

- [ ] **Step 1: Create `frontend/src/components/portfolio/AddPositionModal.tsx`**

```tsx
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPortfolio } from "../../api/portfolio";
import { fetchVerdicts } from "../../api/portfolio";
import { addPosition } from "../../api/portfolio";
import { triggerJob } from "../../api/jobs";
import { TickerSearch } from "../ui/TickerSearch";
import { useToastStore } from "../../store/toastStore";
import type { TickerSelection, PositionRow } from "../../types/api";

type UnitCurrency = "USD" | "ILA" | "GBP" | "EUR";

function getUnitCurrency(exchange: string): UnitCurrency {
  if (exchange === "TASE") return "ILA";
  if (exchange === "LSE") return "GBP";
  if (exchange === "XETRA" || exchange === "EURONEXT") return "EUR";
  return "USD";
}

function getCurrencyLabel(exchange: string): string {
  if (exchange === "TASE") return "ILA (agorot)";
  if (exchange === "LSE") return "GBP";
  if (exchange === "XETRA" || exchange === "EURONEXT") return "EUR";
  return "USD";
}

interface AddPositionModalProps {
  open: boolean;
  onClose: () => void;
  onEditExisting: (ticker: string) => void;
}

export function AddPositionModal({ open, onClose, onEditExisting }: AddPositionModalProps) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const [selected, setSelected] = useState<TickerSelection | null>(null);
  const [account, setAccount] = useState("");
  const [shares, setShares] = useState("");
  const [avgBuyPrice, setAvgBuyPrice] = useState("");
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    staleTime: 60_000,
  });

  const { data: verdictsData } = useQuery({
    queryKey: ["verdicts"],
    queryFn: fetchVerdicts,
    staleTime: 60_000,
  });

  const accounts = portfolio?.accounts ?? [];

  // Clash: positions that already hold this ticker
  const clashPositions: PositionRow[] = useMemo(() => {
    if (!selected || !portfolio) return [];
    return portfolio.positions.filter((p) => p.ticker === selected.symbol);
  }, [selected, portfolio]);

  const clashAccounts = useMemo(
    () => clashPositions.flatMap((p) => p.accounts),
    [clashPositions]
  );

  const hasClash = clashPositions.length > 0 && !force;

  // Are there accounts that don't already hold this ticker?
  const cleanAccounts = useMemo(
    () => accounts.filter((a) => !clashAccounts.includes(a)),
    [accounts, clashAccounts]
  );

  const needsDeepDive = useMemo(() => {
    if (!selected || !verdictsData) return false;
    return !verdictsData.verdicts.find((v) => v.ticker === selected.symbol);
  }, [selected, verdictsData]);

  // Default account on selection
  useEffect(() => {
    if (selected && accounts.length > 0) {
      const firstClean = cleanAccounts[0] ?? accounts[0] ?? "";
      setAccount(firstClean);
    }
  }, [selected, accounts, cleanAccounts]);

  const handleClose = () => {
    setSelected(null);
    setAccount("");
    setShares("");
    setAvgBuyPrice("");
    setForce(false);
    onClose();
  };

  const handleSubmit = async () => {
    if (!selected || !account || !shares || !avgBuyPrice) return;
    const sharesNum = parseInt(shares, 10);
    const priceNum = parseFloat(avgBuyPrice);
    if (isNaN(sharesNum) || sharesNum <= 0 || isNaN(priceNum) || priceNum <= 0) return;

    setSubmitting(true);
    try {
      await addPosition({
        ticker: selected.symbol,
        exchange: selected.exchange,
        shares: sharesNum,
        unitAvgBuyPrice: priceNum,
        unitCurrency: getUnitCurrency(selected.exchange),
        account,
        force,
      });

      if (needsDeepDive) {
        try {
          await triggerJob("deep_dive", selected.symbol);
          showToast("Position added — deep dive queued", "success");
        } catch (err: unknown) {
          const axiosErr = err as { response?: { status?: number } };
          if (axiosErr.response?.status === 429) {
            showToast("Position added — deep dive rate limit reached, trigger manually from Controls", "warning");
          } else {
            showToast("Position added", "success");
          }
        }
      } else {
        showToast("Position added", "success");
      }

      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      handleClose();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const errMsg = axiosErr.response?.data?.error;
      if (errMsg === "account_not_found") {
        showToast("Account not found", "error");
      } else {
        showToast("Failed to add position", "error");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const canSubmit = !!selected && !!account && !!shares && !!avgBuyPrice && !hasClash && !submitting;
  const currencyLabel = selected ? getCurrencyLabel(selected.exchange) : "USD";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Sheet: bottom on mobile, centered on sm+ */}
      <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center">
        <div
          className="bg-[var(--color-bg-base)] rounded-t-2xl sm:rounded-2xl sm:max-w-md sm:w-full w-full max-h-[90vh] overflow-y-auto"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-bold text-[var(--color-fg-default)]">Add Position</h2>
            <button
              type="button"
              onClick={handleClose}
              className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-default)] text-xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="px-4 py-4 space-y-4">
            {/* Ticker search */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
                Search Stock
              </label>
              <TickerSearch
                value={selected}
                onChange={(val) => {
                  setSelected(val);
                  setForce(false);
                }}
              />
            </div>

            {/* Clash warning */}
            {selected && hasClash && (
              <div className="bg-[var(--color-accent-red)]/10 border border-[var(--color-accent-red)]/30 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-[var(--color-accent-red)]">
                  ⚠️ Already in your portfolio
                </p>
                <p className="text-[10px] text-[var(--color-fg-muted)]">
                  {clashPositions.map((p) =>
                    `${p.accounts.join(", ")} · ${p.shares} shares`
                  ).join(" | ")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {cleanAccounts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setForce(true); setAccount(cleanAccounts[0]!); }}
                      className="text-[10px] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-fg-default)]"
                    >
                      Add to different account
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setForce(true)}
                    className="text-[10px] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-fg-default)]"
                  >
                    Add anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => { onEditExisting(selected.symbol); handleClose(); }}
                    className="text-[10px] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-accent-blue)]"
                  >
                    Edit existing
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="text-[10px] bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-[var(--color-fg-muted)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Form fields — visible once ticker is selected (and clash resolved) */}
            {selected && (!hasClash) && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
                      Account
                    </label>
                    <select
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] focus:border-[var(--color-accent-blue)] rounded-xl px-3 py-2.5 text-xs text-[var(--color-fg-default)] outline-none"
                    >
                      {accounts.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
                      Shares
                    </label>
                    <input
                      type="number"
                      value={shares}
                      onChange={(e) => setShares(e.target.value)}
                      min="1"
                      step="1"
                      placeholder="100"
                      className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] focus:border-[var(--color-accent-blue)] rounded-xl px-3 py-2.5 text-xs text-[var(--color-fg-default)] outline-none"
                      style={{ fontSize: "16px" }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)] mb-1.5">
                    Avg Buy Price ({currencyLabel})
                  </label>
                  <input
                    type="number"
                    value={avgBuyPrice}
                    onChange={(e) => setAvgBuyPrice(e.target.value)}
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] focus:border-[var(--color-accent-blue)] rounded-xl px-3 py-2.5 text-xs text-[var(--color-fg-default)] outline-none"
                    style={{ fontSize: "16px" }}
                  />
                </div>

                {/* Deep dive notice */}
                {needsDeepDive && (
                  <div className="flex gap-2 items-start bg-[var(--color-accent-blue)]/10 border border-[var(--color-accent-blue)]/30 rounded-xl px-3 py-2.5">
                    <span className="text-sm flex-shrink-0">🔬</span>
                    <p className="text-[10px] text-[var(--color-accent-blue)]">
                      No analysis found for {selected.symbol} — a deep dive will be queued automatically when you save.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 px-4 py-3 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-xs text-[var(--color-fg-muted)] bg-[var(--color-bg-muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 py-2.5 rounded-xl bg-[var(--color-accent-blue)] text-white text-xs font-semibold disabled:opacity-40"
            >
              {submitting ? "Adding…" : "Add Position"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /root/clawd
git add frontend/src/components/portfolio/AddPositionModal.tsx
git commit -m "feat: AddPositionModal — bottom sheet with clash detection and auto deep-dive queue"
```

---

## Task 6: Wire Portfolio Page

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx`

- [ ] **Step 1: Add imports and state to `Portfolio.tsx`**

Add to the import block at the top:
```tsx
import { AddPositionModal } from "../components/portfolio/AddPositionModal";
```

Add state inside the `Portfolio` function (after line 20):
```tsx
const [addPositionOpen, setAddPositionOpen] = useState(false);
const [editingTicker, setEditingTicker] = useState<string | null>(null);
```

- [ ] **Step 2: Wire the Add Position button (line 151)**

Replace:
```tsx
<button
  onClick={() => {/* TODO: Navigate to add position */}}
  className="w-full py-2.5 rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-accent-blue)] font-medium hover:bg-[var(--color-bg-muted)] transition-colors"
>
  {t("addPosition", language)}
</button>
```

With:
```tsx
<button
  onClick={() => setAddPositionOpen(true)}
  className="w-full py-2.5 rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-accent-blue)] font-medium hover:bg-[var(--color-bg-muted)] transition-colors"
>
  {t("addPosition", language)}
</button>
```

- [ ] **Step 3: Add modal and handle edit-existing flow**

The `PositionDetailModal` at the bottom of Portfolio.tsx is currently controlled by `selectedPosition`. We need to also be able to open it for a ticker (by ticker string) from the clash warning.

Add a `useEffect` that resolves `editingTicker` to a position:
```tsx
useEffect(() => {
  if (editingTicker && portfolio) {
    const pos = portfolio.positions.find((p) => p.ticker === editingTicker) ?? null;
    setSelectedPosition(pos);
    setEditingTicker(null);
  }
}, [editingTicker, portfolio]);
```

Add the `AddPositionModal` just before the closing `</>` of the return:
```tsx
<AddPositionModal
  open={addPositionOpen}
  onClose={() => setAddPositionOpen(false)}
  onEditExisting={(ticker) => {
    setAddPositionOpen(false);
    setEditingTicker(ticker);
  }}
/>
```

- [ ] **Step 4: Build and verify in browser**

```bash
cd /root/clawd && ./deploy.sh
```

Open http://localhost:8081 → Portfolio page → click "Add Position":
- Bottom sheet slides up on mobile / centered modal on desktop ✓
- Type "AA" → dropdown appears with flag + name + exchange + price ✓
- Click AAPL → pill locks in, form fields appear ✓
- If AAPL already in portfolio → amber clash warning appears ✓
- If no strategy for ticker → blue deep dive notice appears ✓
- Fill shares + price → Add Position button enables ✓
- Submit → toast appears, portfolio refreshes ✓

- [ ] **Step 5: Commit**

```bash
cd /root/clawd
git add frontend/src/pages/Portfolio.tsx
git commit -m "feat: wire Add Position button to AddPositionModal in Portfolio page"
```

---

## Task 7: Controls Page — TickerSearch for Deep Dive

**Files:**
- Modify: `frontend/src/pages/Controls.tsx`

- [ ] **Step 1: Update imports in `Controls.tsx`**

Add to imports:
```tsx
import { TickerSearch } from "../components/ui/TickerSearch";
import type { TickerSelection } from "../types/api";
```

- [ ] **Step 2: Update `ActionCard` to use `TickerSearch` when `tickerRequired`**

Replace the `ticker` state and input inside `ActionCard`:

Current state (line 29):
```tsx
const [ticker, setTicker] = useState("");
```

Replace with:
```tsx
const [tickerSelection, setTickerSelection] = useState<TickerSelection | null>(null);
```

Current input (lines 60-66):
```tsx
{tickerRequired && (
  <input
    type="text"
    value={ticker}
    onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 10))}
    placeholder={t("enterTicker", language)}
    className="w-full bg-[var(--color-bg-muted)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-[var(--color-fg-default)] outline-none focus:border-[var(--color-accent-blue)] mt-1"
  />
)}
```

Replace with:
```tsx
{tickerRequired && (
  <div className="mt-1">
    <TickerSearch
      value={tickerSelection}
      onChange={setTickerSelection}
      placeholder={t("enterTicker", language)}
    />
  </div>
)}
```

Current trigger call (line 40):
```tsx
const res = await triggerJob(action, tickerRequired ? ticker.trim().toUpperCase() : undefined);
```

Replace with:
```tsx
const res = await triggerJob(action, tickerRequired ? tickerSelection?.symbol : undefined);
```

Current validation (line 34):
```tsx
if (tickerRequired && !ticker.trim()) {
```

Replace with:
```tsx
if (tickerRequired && !tickerSelection) {
```

Current reset after trigger (line 43):
```tsx
if (tickerRequired) setTicker("");
```

Replace with:
```tsx
if (tickerRequired) setTickerSelection(null);
```

- [ ] **Step 3: Disable Run button until ticker selected**

The button at lines 69-73 already uses `loading` for disabled. Add `tickerSelection` check:
```tsx
<button
  onClick={handleTrigger}
  disabled={loading || (tickerRequired && !tickerSelection)}
  className="w-full py-2 rounded-lg bg-[var(--color-accent-blue)] text-white text-xs font-semibold disabled:opacity-50 mt-1"
>
  {loading ? "..." : t("run", language)}
</button>
```

- [ ] **Step 4: Deploy and verify**

```bash
cd /root/clawd && ./deploy.sh
```

Open Controls page → Deep Dive card → type "TSL" → dropdown appears → select TSLA → Run button enables → click Run → job queued toast appears ✓

- [ ] **Step 5: Commit**

```bash
cd /root/clawd
git add frontend/src/pages/Controls.tsx
git commit -m "feat: replace ticker text input with TickerSearch in Controls deep dive card"
```

---

## Task 8: Onboarding Page — TickerSearch in PositionCard

**Files:**
- Modify: `frontend/src/pages/Onboarding.tsx`

- [ ] **Step 1: Add imports**

Add to the import block at the top of `Onboarding.tsx`:
```tsx
import { TickerSearch } from "../components/ui/TickerSearch";
import type { TickerSelection } from "../types/api";
```

- [ ] **Step 2: Update `PositionCard` to use `TickerSearch`**

The `PositionCard` component starts at line 379. It renders a ticker text input at line 406 and an exchange select at line 410.

Replace the entire `PositionCard` function with:

```tsx
function PositionCard({
  pos, idx, accountName, accounts, updateAccount,
}: {
  pos: PositionEntry; idx: number; accountName: string;
  accounts: Account[];
  updateAccount: (id: string, updated: Account) => void;
}) {
  const language = usePreferencesStore((s) => s.language);
  const [tickerSelection, setTickerSelection] = useState<TickerSelection | null>(
    // Restore pill if ticker already set (e.g. user navigated back)
    pos.ticker ? {
      symbol: pos.ticker,
      shortName: pos.ticker,
      exchange: pos.exchange as TickerSelection["exchange"],
      exchDisp: pos.exchange,
      flag: "",
      price: null,
      currency: "USD",
    } : null
  );

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

  const handleTickerChange = (val: TickerSelection | null) => {
    setTickerSelection(val);
    if (val) {
      updatePos({ ticker: val.symbol, exchange: val.exchange });
    } else {
      updatePos({ ticker: "", exchange: "NYSE" });
    }
  };

  return (
    <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-muted)] rounded-lg p-3 relative">
      <button onClick={removePos} className="absolute top-2 right-2 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-red)]">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      </button>

      <div className="mb-2">
        <label className={labelCls}>{t("onboardTickerLabel", language)}</label>
        <TickerSearch value={tickerSelection} onChange={handleTickerChange} placeholder="AAPL" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>{t("onboardSharesLabel", language)}</label>
          <input type="number" value={pos.shares} onChange={(e) => updatePos({ shares: e.target.value })} min="1" step="1" placeholder="100" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{t("onboardAvgPriceLabel", language)} ({pos.currency})</label>
          <input type="number" value={pos.avgPrice} onChange={(e) => updatePos({ avgPrice: e.target.value })} min="0.01" step="0.01" placeholder="150.00" className={inputCls} />
        </div>
      </div>
    </div>
  );
}
```

Note: the exchange `<select>` is removed — exchange is now determined by the TickerSearch selection. The existing `updatePos` logic at `EXCHANGES.find(e => e.value === patch.exchange)!.currency` already derives the correct currency when exchange is set.

- [ ] **Step 3: Deploy and verify**

```bash
cd /root/clawd && ./deploy.sh
```

Open Onboarding page → Step 3 (portfolio entry) → click "+ Add Position" → PositionCard shows TickerSearch → type "AMD" → select from dropdown → shares/price inputs appear with correct currency label ✓

- [ ] **Step 4: Commit**

```bash
cd /root/clawd
git add frontend/src/pages/Onboarding.tsx
git commit -m "feat: replace ticker text input with TickerSearch in Onboarding PositionCard"
```

---

## Task 9: Final Deploy + End-to-End Verify

- [ ] **Step 1: Full deploy**

```bash
cd /root/clawd && ./deploy.sh
```

Expected output ends with: `✓ Backend healthy`

- [ ] **Step 2: End-to-end checklist**

Open http://localhost:8081 and verify each entry point:

**Portfolio → Add Position:**
- [ ] Button opens bottom sheet on mobile / centered modal on desktop
- [ ] Typing 1 char → no dropdown. Typing 2 chars → dropdown appears
- [ ] Each dropdown row shows: flag emoji, bold ticker, company name, exchange badge with flag, price
- [ ] Arrow keys navigate, Enter selects, Escape clears
- [ ] Clicking outside closes dropdown
- [ ] After selection: pill shows flag + symbol + price + exchange + "Change ↩"
- [ ] "Change ↩" resets to search input
- [ ] Clash warning appears for existing tickers with correct action buttons
- [ ] Deep dive notice appears for tickers with no strategy
- [ ] Successful submit: portfolio refreshes, toast appears
- [ ] Auto deep dive: job appears in Controls job list

**Controls → Deep Dive:**
- [ ] TickerSearch renders instead of plain input
- [ ] Run button disabled until ticker selected

**Onboarding → Portfolio Step:**
- [ ] Each PositionCard uses TickerSearch
- [ ] Selecting a ticker sets correct exchange and currency on the price field label

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
cd /root/clawd
git status
# commit any outstanding changes
```
