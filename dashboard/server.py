#!/usr/bin/env python3
"""
Portfolio Dashboard API Server
Serves live portfolio data, verdicts, ideas, and triggers.
"""

import bcrypt
import base64
import concurrent.futures
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from functools import wraps

import requests
import yfinance as yf
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# ─── CONFIG ────────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "data"))
PORTFOLIO_FILE = os.path.join(DATA_DIR, "portfolio.json")
JOURNAL_FILE = os.path.join(DATA_DIR, "trade_journal.md")
REPORTS_DIR = os.path.join(DATA_DIR, "reports")
TICKERS_DIR = os.path.join(DATA_DIR, "tickers")
TRIGGERS_DIR = os.path.join(DATA_DIR, "triggers")

CACHE_TTL = 300       # 5 min price cache
USD_ILS_TTL = 3600    # 1 hour FX cache

# ─── FLASK ───────────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)

# ─── AUTH ─────────────────────────────────────────────────────────────────────

def _load_hash():
    auth_file = os.path.join(BASE_DIR, "auth.json")
    with open(auth_file) as f:
        return json.load(f)["password_hash"].encode()

def _auth_challenge():
    return jsonify({"error": "unauthorized"}), 401

def _verify_password(password):
    try:
        stored_hash = _load_hash()
        return bcrypt.checkpw(password.encode(), stored_hash)
    except Exception:
        return False

# Session tokens: token -> True (valid)
_session_tokens = {}

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
            if token in _session_tokens:
                return f(*args, **kwargs)
            return _auth_challenge()
        if auth.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth[6:]).decode("utf-8")
                _, password = decoded.split(":", 1)
                if _verify_password(password):
                    return f(*args, **kwargs)
            except Exception:
                pass
        return _auth_challenge()
    return decorated

# ─── CACHE ────────────────────────────────────────────────────────────────────

_price_cache = {}   # {ticker: (price, ts)}
_ils_cache = {"rate": 3.16, "ts": 0}
_cache = {}         # endpoint cache {key: (val, ts)}

# ─── JOBS ─────────────────────────────────────────────────────────────────────
JOBS_DIR = os.path.join(DATA_DIR, "jobs")
os.makedirs(JOBS_DIR, exist_ok=True)

def _job_path(job_id):
    return os.path.join(JOBS_DIR, f"{job_id}.json")

def _write_job(job):
    with open(_job_path(job["id"]), "w") as f:
        json.dump(job, f, indent=2)

def _read_job(job_id):
    p = _job_path(job_id)
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return json.load(f)

# ─── HELPERS ─────────────────────────────────────────────────────────────────

def _now():
    return time.time()

def _cache_get(key, ttl):
    if key in _cache:
        v, t = _cache[key]
        if _now() - t < ttl:
            return v
    return None

def _cache_set(key, val):
    _cache[key] = (val, _now())

def _get_usd_ils():
    """Fetch USD/ILS from Frankfurter API (ECB). Falls back to cached."""
    cached_rate = _ils_cache.get("rate", 3.16)
    cached_ts   = _ils_cache.get("ts", 0)
    if _now() - cached_ts < USD_ILS_TTL:
        return cached_rate
    try:
        r = requests.get("https://api.frankfurter.app/latest?from=USD&to=ILS", timeout=5)
        rate = float(r.json()["rates"]["ILS"])
        _ils_cache["rate"] = rate
        _ils_cache["ts"]   = _now()
        return rate
    except Exception:
        return cached_rate

def _fetch_price(ticker, exchange, rate):
    """Returns price in ILS (TASE stocks or USD-converted)."""
    key = f"{exchange}:{ticker}"
    if key in _price_cache:
        p, t = _price_cache[key]
        if _now() - t < CACHE_TTL:
            return p

    # For TASE: Yahoo Finance returns prices in agorot (e.g., 30500 = ₪305)
    # Convert to ILS (divide by 100) before storing — all downstream code uses ILS
    if exchange == "TASE":
        yf_t = f"{ticker}.TA"
        try:
            df = yf.Ticker(yf_t).history(period="2d", timeout=5)
            if not df.empty:
                p = float(df["Close"].iloc[-1])
                if not (p != p):  # filter NaN
                    p_ils = p / 100.0  # agorot -> ILS
                    _price_cache[key] = (p_ils, _now())
                    return p_ils
        except Exception:
            pass
    else:
        # US stocks: convert USD to ILS before storing
        # fast_info is fast but often returns None — skip to avoid double network call
        try:
            df = yf.Ticker(ticker).history(period="1d", timeout=5)
            if not df.empty:
                p = float(df["Close"].iloc[-1])
                if p and p > 0:
                    p_ils = float(p) * rate  # USD -> ILS
                    _price_cache[key] = (p_ils, _now())
                    return p_ils
        except Exception:
            pass

    # Stale cache as last resort
    if key in _price_cache:
        return _price_cache[key][0]
    return None

def _price(ticker, exchange, rate):
    """Get price in ILS or 0 if unavailable."""
    p = _fetch_price(ticker, exchange, rate)
    return p if p else 0.0

def _ila_ils(ila_price, shares):
    """Agorot price * shares -> ILS."""
    return (ila_price / 100) * shares

def _usd_ils(usd_price, shares, rate):
    """USD price * shares * rate -> ILS."""
    return usd_price * shares * rate

def _fmt_verdict(text):
    if not text:
        return "HOLD", "green"
    t = text.upper()
    if "BUY" in t:    return "BUY", "blue"
    if "ADD" in t:    return "ADD", "blue"
    if "REDUCE" in t: return "REDUCE", "yellow"
    if "SELL" in t or "CLOSE" in t: return "SELL", "red"
    return "HOLD", "green"

# ─── ROUTES ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/api/portfolio")
@require_auth
def api_portfolio():
    cached = _cache_get("portfolio", CACHE_TTL)
    if cached:
        return jsonify(cached)

    with open(PORTFOLIO_FILE) as f:
        portfolio = json.load(f)

    rate = _get_usd_ils()

    # Collect unique tickers per exchange BEFORE fetching prices
    unique = {}  # key: (ticker, exchange) -> avg (first seen)
    entries_by_ticker = {}  # ticker -> list of {account, shares, avg, exchange}
    accounts = portfolio.get("accounts", {})
    for acct, acct_data in accounts.items():
        if not isinstance(acct_data, list):
            continue
        for e in acct_data:
            t = e["ticker"]
            sh = e["shares"]
            avg = float(e["unitAvgBuyPrice"])
            exc = e.get("exchange", "USD")
            if t not in entries_by_ticker:
                entries_by_ticker[t] = []
            entries_by_ticker[t].append({"account": acct, "shares": sh, "avg": avg, "exchange": exc})
            key = (t, exc)
            if key not in unique:
                unique[key] = {"ticker": t, "exchange": exc, "avg": avg}

    # Parallel fetch all unique tickers
    def _fetch_one(key_item):
        t, exc = key_item
        return (t, exc), _price(t, exc, rate)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        price_results = dict(pool.map(_fetch_one, unique.keys()))

    # Build raw list from fetched prices
    raw = []
    for t, entry_list in entries_by_ticker.items():
        exc = entry_list[0]["exchange"]
        lp = price_results.get((t, exc), 0.0) or 0.0
        for e in entry_list:
            sh = e["shares"]
            avg = e["avg"]
            if exc == "TASE":
                cost = (avg / 100) * sh
                cur = lp * sh if lp > 0 else cost
                lpd = lp if lp > 0 else avg / 100
                avd = avg / 100
            else:
                cost = avg * sh * rate
                cur = lp * sh if lp > 0 else cost
                lpd = lp if lp > 0 else avg * rate
                avd = avg * rate
            raw.append({
                "ticker": t, "exchange": exc, "account": e["account"],
                "shares": sh, "avgPrice": round(avd, 2),
                "livePrice": round(lpd, 2),
                "currentILS": round(cur, 2), "costILS": round(cost, 2),
                "plILS": round(cur - cost, 2),
                "_avg_ag": avg,
                "_lp_raw": lp * 100 if exc == "TASE" else lp / rate,
            })

    # Consolidate duplicate tickers across accounts
    by_ticker = {}
    for r in raw:
        t = r["ticker"]
        if t not in by_ticker:
            by_ticker[t] = r.copy()
            by_ticker[t]["accounts"] = [r["account"]]
        else:
            by_ticker[t]["shares"]     += r["shares"]
            by_ticker[t]["currentILS"] += r["currentILS"]
            by_ticker[t]["costILS"]    += r["costILS"]
            by_ticker[t]["plILS"]      += r["plILS"]
            by_ticker[t]["accounts"].append(r["account"])
            # Merge raw values (keep latest; both should be same ticker)
            by_ticker[t]["_avg_ag"] = r.get("_avg_ag", by_ticker[t].get("_avg_ag", 0))
            by_ticker[t]["_lp_raw"] = r.get("_lp_raw", by_ticker[t].get("_lp_raw", 0))

    total = sum(v["currentILS"] for v in by_ticker.values())
    positions = []
    for t, v in by_ticker.items():
        exc = v["exchange"]
        sh  = v["shares"]
        # avgPrice is avg per share in ILS (USD stocks) or ILS (TASE stocks after /100)
        # avd  = avg / 100 (TASE) or avg (USD)
        # lpd  = live / 100 (TASE) or live (USD)
        # raw avg in agorot: avg_ag = avg (TASE) or avg * 100 * rate (USD)
        # raw live in agorot: lp_ag = live * 100 (TASE) or live * 100 * rate (USD)
        if exc == "TASE":
            # avg is in agorot (e.g., 4000), live is stored in agorot (e.g., 30500)
            avg_ag = v.get("_avg_ag", 0)
            lp_ag  = v.get("_lp_raw", 0)
            cost_correct = avg_ag * sh / 100
            pl_correct   = (lp_ag - avg_ag) * sh / 100
        else:
            # USD: avg in USD, live in USD
            avg_usd = v.get("_avg_ag", 0)    # raw avg in USD
            lp_usd  = v.get("_lp_raw", 0)    # raw live in USD
            cost_correct = avg_usd * sh * rate
            pl_correct   = (lp_usd - avg_usd) * sh * rate
        pl_pct = (pl_correct / cost_correct * 100) if cost_correct > 0 else 0
        wt = (v["currentILS"] / total * 100) if total > 0 else 0
        positions.append({
            "ticker": t, "exchange": exc,
            "shares": sh, "accounts": v["accounts"],
            "avgPrice": v["avgPrice"], "livePrice": v["livePrice"],
            "currentILS": round(v["currentILS"], 2), "costILS": round(cost_correct, 2),
            "plILS": round(pl_correct, 2), "plPct": round(pl_pct, 2),
            "weightPct": round(wt, 2),
        })
    positions.sort(key=lambda x: x["currentILS"], reverse=True)

    result = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "usdIlsRate": round(rate, 4),
        "totalILS": round(total, 2),
        "positions": positions,
    }
    _cache_set("portfolio", result)
    return jsonify(result)

@app.route("/api/verdicts")
@require_auth
def api_verdicts():
    cached = _cache_get("verdicts", CACHE_TTL)
    if cached:
        return jsonify(cached)

    verdicts = []
    td = TICKERS_DIR
    if os.path.exists(td):
        for tdir in os.listdir(td):
            sfile = os.path.join(td, tdir, f"{tdir}.md")
            if not os.path.exists(sfile):
                continue
            try:
                with open(sfile) as f:
                    content = f.read()
                v = "HOLD"; conf = "medium"; reason = ""; tf = ""; ps = ""; ee = ""
                for line in content.split("\n"):
                    lv = line.strip()
                    if lv.startswith("FUND MANAGER VERDICT"):
                        parts = lv.split(":", 1)
                        if len(parts) > 1:
                            raw = parts[1].strip().split()[0] if parts[1].strip() else "HOLD"
                            v = _fmt_verdict(raw)[0]
                    elif lv.startswith("CONFIDENCE"):
                        conf = (lv.split(":", 1)[1].strip().lower()) if ":" in lv else "medium"
                    elif lv.startswith("REASONING"):
                        reason = (lv.split(":", 1)[1].strip()) if ":" in lv else ""
                    elif lv.startswith("TIMEFRAME"):
                        tf = (lv.split(":", 1)[1].strip()) if ":" in lv else ""
                    elif lv.startswith("POSITION SIZE"):
                        ps = (lv.split(":", 1)[1].strip()) if ":" in lv else ""
                    elif lv.startswith("ENTRY/EXIT CONDITIONS"):
                        ee = (lv.split(":", 1)[1].strip()) if ":" in lv else ""
                badge, color = _fmt_verdict(v)
                verdicts.append({
                    "ticker": tdir.upper(), "verdict": badge, "color": color,
                    "confidence": conf,
                    "reason": (reason[:120] + "...") if len(reason) > 120 else reason,
                    "timeframe": tf, "positionSize": ps, "entryExit": ee,
                    "updated": datetime.fromtimestamp(os.path.getmtime(sfile), tz=timezone.utc).isoformat(),
                })
            except Exception:
                continue

    verdicts.sort(key=lambda x: x["ticker"])
    result = {"updated": datetime.now(timezone.utc).isoformat(), "verdicts": verdicts}
    _cache_set("verdicts", result)
    return jsonify(result)

@app.route("/api/ideas")
@require_auth
def api_ideas():
    cached = _cache_get("ideas", CACHE_TTL)
    if cached:
        return jsonify(cached)

    ideas = []
    # Parse trade journal
    if os.path.exists(JOURNAL_FILE):
        try:
            with open(JOURNAL_FILE) as f:
                txt = f.read()
            for m in re.finditer(r'\[(\d{4}-\d{2}-\d{2})\]\s+([A-Z]+)\s+—\s+(.+)', txt):
                d, action, rest = m.group(1), m.group(2), m.group(3)
                parts = rest.split("—")
                ideas.append({
                    "date": d, "ticker": action if action.isalpha() else "",
                    "action": parts[0].strip() if parts else rest,
                    "reasoning": parts[-1].strip() if len(parts) > 1 else rest,
                })
        except Exception:
            pass

    # Parse NEW-IDEA files
    rd = REPORTS_DIR
    if os.path.exists(rd):
        for fname in os.listdir(rd):
            if not fname.startswith("NEW-IDEA-"):
                continue
            fpath = os.path.join(rd, fname)
            try:
                with open(fpath) as f:
                    txt = f.read()
                ticker = fname.replace("NEW-IDEA-", "").replace(".md", "")
                fields = {"thesis":"","entry":"","target":"","stop":"","timeframe":"","size":"","urgency":""}
                for line in txt.split("\n"):
                    lv = line.strip()
                    if lv.startswith("Thesis:"):        fields["thesis"]     = lv.split(":",1)[1].strip()
                    elif lv.startswith("Entry condition:"): fields["entry"]   = lv.split(":",1)[1].strip()
                    elif lv.startswith("Target price:") or lv.startswith("Target:"): fields["target"] = lv.split(":",1)[1].strip()
                    elif lv.startswith("Stop-loss:") or lv.startswith("Stop:"): fields["stop"]  = lv.split(":",1)[1].strip()
                    elif lv.startswith("Timeframe:"):   fields["timeframe"]  = lv.split(":",1)[1].strip()
                    elif lv.startswith("Size:"):        fields["size"]       = lv.split(":",1)[1].strip()
                    elif lv.startswith("Urgency:"):     fields["urgency"]    = lv.split(":",1)[1].strip()
                ideas.append({"type":"new_idea","ticker":ticker,**fields})
            except Exception:
                pass

    result = {"updated": datetime.now(timezone.utc).isoformat(), "ideas": ideas}
    _cache_set("ideas", result)
    return jsonify(result)

@app.route("/api/reports")
@require_auth
def api_reports():
    rd = REPORTS_DIR
    report_types = ["fundamentals","technical","sentiment","macro","risk"]
    out = {}
    if os.path.exists(rd):
        for tdir in os.listdir(rd):
            tpath = os.path.join(rd, tdir)
            if not os.path.isdir(tpath):
                continue
            reports = []
            for rt in report_types:
                rfile = os.path.join(tpath, f"{rt}.md")
                if os.path.exists(rfile):
                    mt = os.path.getmtime(rfile)
                    reports.append({
                        "type": rt,
                        "fresh": (_now() - mt) < 86400 * 7,
                        "updated": datetime.fromtimestamp(mt, tz=timezone.utc).isoformat(),
                    })
            if reports:
                out[tdir.upper()] = reports
    return jsonify({"updated": datetime.now(timezone.utc).isoformat(), "reports": out})

@app.route("/api/strategy/<ticker>")
@require_auth
def api_strategy(ticker):
    ticker = ticker.upper()
    sfile = os.path.join(TICKERS_DIR, ticker, f"{ticker}.md")
    if not os.path.exists(sfile):
        return jsonify({"error": "not found"}), 404
    with open(sfile) as f:
        txt = f.read()
    return txt, 200, {"Content-Type": "text/plain; charset=utf-8"}

# ─── REPORT HISTORY ───────────────────────────────────────────────────────────

@app.route("/api/reports/history")
@require_auth
def api_reports_history():
    """Returns all reports grouped by date and mode type."""
    cached = _cache_get("reports_history", CACHE_TTL)
    if cached:
        return jsonify(cached)
    rd = REPORTS_DIR
    ANALYST_TYPES = ["fundamentals", "technical", "sentiment", "macro", "risk"]

    entries = []  # one entry per ticker per analysis run

    if os.path.exists(rd):
        for tdir in os.listdir(rd):
            tpath = os.path.join(rd, tdir)
            if not os.path.isdir(tpath):
                continue
            ticker = tdir.upper()
            files = {}
            if os.path.exists(tpath):
                for f in os.listdir(tpath):
                    if f.endswith(".md"):
                        files[f.replace(".md", "")] = os.path.join(tpath, f)

            # Detect mode type
            has_bull = "bull_case" in files
            has_bear = "bear_case" in files
            has_mode1 = "mode1" in files
            is_deep_dive = has_bull and has_bear

            # Determine date: use newest file mtime
            all_mtimes = []
            for fpath in files.values():
                try:
                    all_mtimes.append(os.path.getmtime(fpath))
                except Exception:
                    pass

            if not all_mtimes:
                continue
            newest_mt = max(all_mtimes)
            newest_iso = datetime.fromtimestamp(newest_mt, tz=timezone.utc).strftime("%Y-%m-%d")
            newest_full = datetime.fromtimestamp(newest_mt, tz=timezone.utc).isoformat()

            # Collect available analyst types
            available_types = []
            for atype in ANALYST_TYPES:
                if atype in files:
                    mt = os.path.getmtime(files[atype])
                    available_types.append({
                        "type": atype,
                        "updated": datetime.fromtimestamp(mt, tz=timezone.utc).isoformat(),
                        "size": os.path.getsize(files[atype]),
                    })

            # Parse verdict if strategy file exists
            verdict = None; confidence = None; reasoning = None
            timeframe = None; position_size = None; entry_exit = None
            sfile = os.path.join(TICKERS_DIR, ticker, f"{ticker}.md")
            if os.path.exists(sfile):
                try:
                    with open(sfile) as f:
                        content = f.read()
                    for line in content.split("\n"):
                        lv = line.strip()
                        if lv.startswith("FUND MANAGER VERDICT"):
                            parts = lv.split(":", 1)
                            if len(parts) > 1:
                                verdict = parts[1].strip().split()[0] if parts[1].strip() else None
                        elif lv.startswith("CONFIDENCE"):
                            confidence = (lv.split(":", 1)[1].strip().lower()) if ":" in lv else None
                        elif lv.startswith("REASONING"):
                            reasoning = (lv.split(":", 1)[1].strip()) if ":" in lv else None
                        elif lv.startswith("TIMEFRAME"):
                            timeframe = (lv.split(":", 1)[1].strip()) if ":" in lv else None
                        elif lv.startswith("POSITION SIZE"):
                            position_size = (lv.split(":", 1)[1].strip()) if ":" in lv else None
                        elif lv.startswith("ENTRY/EXIT CONDITIONS"):
                            entry_exit = (lv.split(":", 1)[1].strip()) if ":" in lv else None
                except Exception:
                    pass

            if is_deep_dive:
                mode = "deep_dive"
            elif has_mode1:
                mode = "daily"
            else:
                mode = "full_report"  # Mode 4 runs all tickers without mode1/bull_bear

            entry = {
                "ticker": ticker,
                "mode": mode,
                "date": newest_iso,
                "updated": newest_full,
                "mtime": newest_mt,
                "has_bull_case": has_bull,
                "has_bear_case": has_bear,
                "has_mode1": has_mode1,
                "analyst_types": available_types,
                "verdict": verdict,
                "verdict_color": _fmt_verdict(verdict or "")[1] if verdict else "gray",
                "confidence": confidence,
                "reasoning": (reasoning[:150] + "...") if reasoning and len(reasoning) > 150 else reasoning,
                "timeframe": timeframe,
                "position_size": position_size,
                "entry_exit": entry_exit,
            }
            entries.append(entry)

    # Group by date desc, then mode
    entries.sort(key=lambda x: (-x["mtime"], x["mode"]))

    # Build grouped output
    by_date = {}
    for e in entries:
        d = e["date"]
        if d not in by_date:
            by_date[d] = {"date": d, "deep_dives": [], "daily": [], "full_reports": []}
        bucket = {
            "ticker": e["ticker"], "mode": e["mode"],
            "updated": e["updated"], "verdict": e["verdict"],
            "verdict_color": e["verdict_color"], "confidence": e["confidence"],
            "reasoning": e["reasoning"], "timeframe": e["timeframe"],
            "position_size": e["position_size"], "entry_exit": e["entry_exit"],
            "has_bull_case": e["has_bull_case"], "has_bear_case": e["has_bear_case"],
            "has_mode1": e["has_mode1"], "analyst_types": e["analyst_types"],
        }
        if e["mode"] == "deep_dive":
            by_date[d]["deep_dives"].append(bucket)
        elif e["mode"] == "daily":
            by_date[d]["daily"].append(bucket)
        else:
            by_date[d]["full_reports"].append(bucket)

    # Flatten sorted list
    grouped = sorted(by_date.values(), key=lambda x: x["date"], reverse=True)

    result = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "groups": grouped,
        "total_entries": len(entries),
    }
    _cache_set("reports_history", result)
    return jsonify(result)


@app.route("/api/report/<ticker>/<rtype>")
@require_auth
def api_report_get(ticker, rtype):
    """Returns raw content of a specific report file."""
    ticker = ticker.upper()
    rtype = rtype.lower()
    VALID_TYPES = ["fundamentals", "technical", "sentiment", "macro", "risk",
                    "bull_case", "bear_case", "mode1"]
    if rtype not in VALID_TYPES:
        return jsonify({"error": "invalid report type"}), 400
    rpath = os.path.join(REPORTS_DIR, ticker, f"{rtype}.md")
    if not os.path.exists(rpath):
        return jsonify({"error": "not found"}), 404
    with open(rpath) as f:
        content = f.read()
    mt = os.path.getmtime(rpath)
    return jsonify({
        "ticker": ticker, "type": rtype,
        "updated": datetime.fromtimestamp(mt, tz=timezone.utc).isoformat(),
        "content": content,
    })


@app.route("/api/strategies")
@require_auth
def api_strategies():
    """Returns all strategy files, parsed into structured records."""
    cached = _cache_get("strategies", CACHE_TTL)
    if cached:
        return jsonify(cached)

    strategies = []
    td = TICKERS_DIR
    if os.path.exists(td):
        for tdir in os.listdir(td):
            sfile = os.path.join(td, tdir, f"{tdir}.md")
            if not os.path.exists(sfile):
                continue
            try:
                with open(sfile) as f:
                    content = f.read()
                v = "HOLD"; conf = "medium"; reason = ""; tf = ""; ps = ""; ee = ""
                has_content = len(content.strip()) > 0
                for line in content.split("\n"):
                    lv = line.strip()
                    if lv.startswith("FUND MANAGER VERDICT"):
                        parts = lv.split(":", 1)
                        if len(parts) > 1:
                            raw = parts[1].strip().split()[0] if parts[1].strip() else "HOLD"
                            v = _fmt_verdict(raw)[0]
                    elif lv.startswith("CONFIDENCE"):
                        conf = (lv.split(":", 1)[1].strip().lower()) if ":" in lv else "medium"
                    elif lv.startswith("REASONING"):
                        reason = (lv.split(":", 1)[1].strip()) if ":" in lv else ""
                    elif lv.startswith("TIMEFRAME"):
                        tf = (lv.split(":", 1)[1].strip()) if ":" in lv else ""
                    elif lv.startswith("POSITION SIZE"):
                        ps = (lv.split(":", 1)[1].strip()) if ":" in lv else ""
                    elif lv.startswith("ENTRY/EXIT CONDITIONS"):
                        ee = (lv.split(":", 1)[1].strip()) if ":" in lv else ""
                badge, color = _fmt_verdict(v)
                strategies.append({
                    "ticker": tdir.upper(),
                    "has_content": has_content,
                    "verdict": badge, "verdict_color": color,
                    "confidence": conf,
                    "reason": (reason[:150] + "...") if len(reason) > 150 else reason,
                    "reason_full": reason,
                    "timeframe": tf, "position_size": ps,
                    "entry_exit": ee,
                    "updated": datetime.fromtimestamp(os.path.getmtime(sfile), tz=timezone.utc).isoformat(),
                })
            except Exception:
                continue

    strategies.sort(key=lambda x: x["ticker"])
    result = {"updated": datetime.now(timezone.utc).isoformat(), "strategies": strategies}
    _cache_set("strategies", result)
    return jsonify(result)

# Old simple trigger (replaced by job queue below)

@app.route("/api/status")
@require_auth
def api_status():
    return jsonify({
        "status": "ok", "updated": datetime.now(timezone.utc).isoformat(),
        "cache_keys": list(_cache.keys()),
        "price_cache": {k: v[0] for k, v in _price_cache.items()},
    })

@app.route("/api/login", methods=["POST"])
def api_login():
    """Accept password, return a session token."""
    data = request.get_json() or {}
    password = data.get("password", "")
    if not _verify_password(password):
        return jsonify({"error": "invalid credentials"}), 401
    import uuid
    token = uuid.uuid4().hex
    _session_tokens[token] = True
    return jsonify({"status": "ok", "token": token})

@app.route("/api/logout", methods=["POST"])
@require_auth
def api_logout():
    """Invalidate the session token."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        _session_tokens.pop(token, None)
    return jsonify({"status": "ok"})

@app.route("/api/jobs", methods=["GET"])
@require_auth
def api_jobs_list():
    jobs = []
    if os.path.exists(JOBS_DIR):
        for fname in sorted(os.listdir(JOBS_DIR), reverse=True):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(JOBS_DIR, fname)) as f:
                    jobs.append(json.load(f))
            except Exception:
                continue
    return jsonify({"jobs": jobs[:50]})

@app.route("/api/jobs/<job_id>", methods=["GET"])
@require_auth
def api_job_get(job_id):
    job = _read_job(job_id)
    if not job:
        return jsonify({"error": "not found"}), 404
    return jsonify(job)

@app.route("/api/trigger", methods=["POST"])
@require_auth
def api_trigger():
    data = request.get_json() or {}
    action = data.get("action", "")
    ticker = (data.get("ticker") or "").upper()
    job_id = f"job_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    job = {
        "id": job_id,
        "action": action,
        "ticker": ticker,
        "status": "pending",
        "triggered_at": datetime.now(timezone.utc).isoformat(),
        "started_at": None,
        "completed_at": None,
        "result": None,
        "error": None,
    }
    _write_job(job)
    os.makedirs(TRIGGERS_DIR, exist_ok=True)
    trigger_path = os.path.join(TRIGGERS_DIR, f"{job_id}.json")
    with open(trigger_path, "w") as f:
        json.dump(job, f, indent=2)
    return jsonify({"status": "ok", "job_id": job_id, "job": job})

SNAPSHOTS_DIR = os.path.join(REPORTS_DIR, "snapshots")
INDEX_DIR = os.path.join(REPORTS_DIR, "index")

@app.route("/api/reports/meta")
@require_auth
def api_reports_meta():
    meta_path = os.path.join(INDEX_DIR, "meta.json")
    if not os.path.exists(meta_path):
        return jsonify({"totalBatches": 0, "totalPages": 0, "pageSize": 10})
    with open(meta_path) as f:
        return jsonify(json.load(f))

@app.route("/api/reports/page/<int:page_num>")
@require_auth
def api_reports_page(page_num):
    page_path = os.path.join(INDEX_DIR, f"page-{page_num:03d}.json")
    if not os.path.exists(page_path):
        return jsonify({"error": "page not found"}), 404
    cached = _cache_get(f"reports_page_{page_num}", CACHE_TTL)
    if cached:
        return jsonify(cached)
    with open(page_path) as f:
        data = json.load(f)
    _cache_set(f"reports_page_{page_num}", data)
    return jsonify(data)

@app.route("/api/reports/batch/<batch_id>/<ticker>/<rtype>")
@require_auth
def api_reports_batch_file(batch_id, ticker, rtype):
    ticker = ticker.upper()
    rtype = rtype.lower()
    VALID_TYPES = ["fundamentals","technical","sentiment","macro","risk","bull_case","bear_case","mode1","strategy"]
    if rtype not in VALID_TYPES:
        return jsonify({"error": "invalid type"}), 400
    fpath = os.path.join(SNAPSHOTS_DIR, batch_id, ticker, f"{rtype}.md")
    if not os.path.exists(fpath):
        return jsonify({"error": "not found"}), 404
    with open(fpath) as f:
        content = f.read()
    return jsonify({"batchId": batch_id, "ticker": ticker, "type": rtype, "content": content})

# ─── MAIN ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()
    app.run(host="0.0.0.0", port=args.port, debug=args.debug)
