# Ticker Search + Add Position Design

**Date:** 2026-04-09  
**Status:** Approved

---

## Summary

Two tightly coupled features:

1. **TickerSearch** — a reusable live-search component that replaces every raw ticker text input in the app. The user types, a dropdown suggests matching stocks with flag, exchange, and live price. The user picks one; the input locks to a pill showing the selected stock.

2. **Add Position** — wires the Portfolio page's "Add Position" button to a real modal that uses TickerSearch, detects clashes with existing positions, and automatically queues a deep dive if no prior analysis exists for the ticker.

---

## Backend

### `GET /api/search/ticker?q=<query>`

- Auth: JWT required (existing `authMiddleware`)
- Calls `yf.search(q, { quotesCount: 6, newsCount: 0, enableFuzzyQuery: false })`
- Filters results to `quoteType === "EQUITY"` only
- For each result, calls `yf.quote(symbol)` in parallel to get live price
- Maps Yahoo exchange codes to the app's `Exchange` enum:

| Yahoo `exchange` field | App Exchange |
|---|---|
| `NMS`, `NGM`, `NCM` | `NASDAQ` |
| `NYQ`, `NYS` | `NYSE` |
| `TLV` | `TASE` |
| `LSE`, `IOB` | `LSE` |
| `GER`, `EBS` | `XETRA` |
| `PAR`, `AMS`, `BRU`, `LIS` | `EURONEXT` |
| anything else | `OTHER` |

- Maps Exchange to flag emoji:

| Exchange | Flag |
|---|---|
| `NASDAQ` | 🇺🇸 |
| `NYSE` | 🇺🇸 |
| `TASE` | 🇮🇱 |
| `LSE` | 🇬🇧 |
| `XETRA` | 🇩🇪 |
| `EURONEXT` | 🇪🇺 |
| `OTHER` | 🌐 |

- Price display: TASE prices divided by 100 (agorot → ILS), shown as `₪X`. LSE shown as `£X`. XETRA/EURONEXT shown as `€X`. All others shown as `$X`.
- 30-second in-memory cache keyed by query string (case-folded, trimmed)
- Returns:
```json
{
  "results": [
    {
      "symbol": "AAPL",
      "shortName": "Apple Inc.",
      "exchange": "NASDAQ",
      "exchDisp": "NASDAQ",
      "flag": "🇺🇸",
      "price": 182.50,
      "currency": "USD"
    }
  ]
}
```
- On `yf.quote()` failure for a result: include the result with `price: null`
- On total failure (search throws): return empty `{ results: [] }` — never 500

### `POST /api/portfolio/position`

- Auth: JWT required
- Body (Zod-validated):
```typescript
{
  ticker: string,        // /^[A-Z0-9]{1,10}$/
  exchange: Exchange,
  shares: number,        // positive integer
  unitAvgBuyPrice: number, // positive — in ILA for TASE, USD for US
  unitCurrency: "USD" | "ILA" | "GBP" | "EUR",
  account: string        // must match an existing account name in portfolio.json
}
```
- Reads `portfolio.json`, checks if `ticker` already exists in **any** account
- If clash: returns `409 { clash: true, existingAccounts: ["Main", ...] }`
- If account not found in portfolio: returns `400 { error: "account_not_found" }`
- On success: appends position to the specified account, writes `portfolio.json`, returns `201 { success: true }`
- `GET /api/portfolio` response must include a top-level `accounts: string[]` field (all account names from `Object.keys(portfolio.accounts)`), so the frontend can populate the account dropdown including empty accounts
- No deep-dive triggering — that is handled client-side

---

## Frontend

### `TickerSearch` component

**Location:** `frontend/src/components/ui/TickerSearch.tsx`

**Props:**
```typescript
interface TickerSearchProps {
  value: TickerSelection | null;
  onChange: (val: TickerSelection | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

interface TickerSelection {
  symbol: string;
  shortName: string;
  exchange: Exchange;
  exchDisp: string;
  flag: string;
  price: number | null;
  currency: string;
}
```

**Behavior:**
- When `value` is null: shows a search input with a 🔍 icon
- Debounce: 300ms before firing the query
- Query fires when input length ≥ 2 characters (single chars return noise)
- Shows a dropdown with up to 6 results while loading/loaded
- Dropdown rows (min-height 48px for mobile tap targets):
  - Flag emoji + bold symbol + company name + exchange badge (`🇺🇸 NASDAQ`) + price (`$182.50` or `₪96.40`)
- User clicks a row → `onChange` called with selection, dropdown closes, pill renders
- **Keyboard navigation:** arrow up/down to move highlight, Enter to select highlighted row, Escape to close dropdown and clear input
- **Click outside:** clicking outside the component closes the dropdown (no selection made)
- When `value` is not null: shows the selected ticker pill
  - Large flag + bold symbol + price + exchange badge
  - "Change ↩" button → calls `onChange(null)`, reopens search input
- Mobile: full-width, dropdown scrollable, 48px row height
- Desktop: same but max-width constrained by parent

**API call:** `GET /api/search/ticker?q=<query>` — new `searchTicker(q)` function in `frontend/src/api/search.ts` (new file, not portfolio.ts)

### `AddPositionModal` component

**Location:** `frontend/src/components/portfolio/AddPositionModal.tsx`

**Trigger:** "Add Position" button in `Portfolio.tsx` (line 151)

**Layout:**
- Mobile: bottom sheet — fixed bottom-0, full width, max-h-[90vh], overflow-y-auto, rounded-t-2xl, slides up with translate-y animation, backdrop overlay
- Desktop: centered modal, max-w-md, rounded-2xl

**State machine:** `idle → selected (ticker chosen) → submitting`

**Form fields (visible after ticker selected):**
- Account: `<select>` populated from `portfolio.data.accounts` (the new top-level accounts list from the portfolio response — includes empty accounts)
- Shares: number input, positive integer
- Avg Buy Price: number input with currency label derived from selected exchange (USD for non-TASE, ILA for TASE)

**Clash detection:**
- After ticker selected: check `portfolio.data.positions` (already loaded in Portfolio page via React Query) for matching ticker
- If clash found: render amber warning banner showing clashing accounts + share counts
  - Three action buttons:
    - **"Add to different account"** — only shown if there is at least one account that does NOT already hold this ticker. Dismisses the warning; account dropdown defaults to the first non-clashing account.
    - **"Add anyway"** — shown when ALL accounts already hold this ticker (second lot in the same account). Dismisses the warning; account dropdown keeps its current selection.
    - **"Edit existing"** — closes modal, opens `PositionDetailModal` for the clashing position
    - **"Cancel"** — closes modal

**Deep dive auto-queue:**
- After ticker selected: check `verdicts.data.verdicts` (already loaded in Portfolio page) for matching ticker
- If no verdict found (`lastDeepDiveAt === null` or ticker absent): show green info banner "No analysis found — a deep dive will be queued automatically when you save."
- On form submit success: if no prior verdict, fire `POST /api/jobs/trigger { action: "deep_dive", ticker }`. On `429` rate limit response, show a warning toast "Deep dive rate limit reached — trigger manually from Controls." On all other errors, silently ignore (position was already saved).

**On success:**
- Invalidate React Query caches: `["portfolio"]`, `["jobs"]`
- Show toast: "Position added" (+ "Deep dive queued" if applicable)
- Close modal

**Error handling:**
- `409 clash`: should not reach submit (clash shown before), but if it does, show toast "Ticker already exists in this account"
- `400 account_not_found`: show inline error
- `429 rate_limit`: show toast with reason from API

### Controls page — deep dive card

**Location:** `frontend/src/pages/Controls.tsx`, `ActionCard` component (line 13)

- When `tickerRequired === true`: replace the plain `<input type="text">` with `<TickerSearch>`
- `ActionCard` receives the selected `TickerSelection | null` and extracts `.symbol` for the job trigger call
- The "Run" button is disabled until a ticker is selected

### Onboarding page — PositionCard

**Location:** `frontend/src/pages/Onboarding.tsx`, `PositionCard` component (line 379)

- Replace the plain text ticker input at line 406 with `<TickerSearch>`
- On selection: populate `pos.ticker` with `symbol`, `pos.exchange` with `exchange`, `pos.currency` with the appropriate `unitCurrency` derived from exchange:
  - `TASE` → `"ILA"`
  - `LSE` → `"GBP"`
  - `XETRA` / `EURONEXT` → `"EUR"`
  - All others → `"USD"`
- The exchange `<select>` below it becomes read-only / hidden when a ticker is selected (exchange is known from search result)

---

## Mobile considerations

- `AddPositionModal`: bottom sheet on mobile (`sm:` breakpoint switches to centered dialog)
- All dropdown rows: `min-h-[48px]` for tap targets
- Backdrop tap closes modal/dropdown
- `TickerSearch` input: `font-size: 16px` minimum to prevent iOS zoom on focus
- Bottom sheet: accounts for iOS safe area inset (`pb-safe` or `padding-bottom: env(safe-area-inset-bottom)`)

---

## Out of scope

- Editing or removing existing positions (covered by existing `PositionDetailModal` + `PATCH /api/position/:ticker`)
- Adding new accounts (accounts are created during onboarding only)
- Pagination of search results (6 results is sufficient for a stock picker)
