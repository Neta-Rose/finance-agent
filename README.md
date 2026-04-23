# Clawd

Clawd is a portfolio-operations product for private investors who want their portfolio to feel actively watched without having to manually re-evaluate every position every day.

## The pain point

A user with 10-30 positions does not want:
- generic market news
- constant expensive re-analysis of every holding
- stale verdicts with no concrete catalysts
- broken alerts
- agent behavior that is hard to trust

What the user wants is simple:
- a strong initial understanding of every position
- clear catalysts and invalidation conditions
- calm daily reassurance when nothing important changed
- fast escalation when something did change
- detailed deep dives only where needed
- delivery in the interface they chose: Telegram, WhatsApp, or web

The product should make the portfolio feel continuously tracked.

## The solution

Clawd is built around a strategy-first workflow.

For each position:
1. A deep dive creates a durable strategy file.
2. The strategy captures thesis, verdict, confidence, catalysts, review horizon, and what would make the thesis wrong.
3. Daily monitoring stays cheap and focused:
   - price moves
   - catalyst dates
   - earnings and material news
   - freshness / time-based review windows
4. If nothing meaningful changed, the system reports that the position is clear.
5. If something meaningful changed, the system escalates that position to a fresh deep dive.

The goal is to spend effort once at the beginning, then preserve quality with selective escalation rather than repeated full re-analysis.

## User experience

The intended user experience is:
- onboarding: connect portfolio and define preferences
- bootstrap: run an initial deep dive across the portfolio
- every day: receive a practical summary
- only changed positions move into deeper analysis
- after deep dive: receive an actionable report with verdict and explanation
- every week: receive a calm review based on plan tier

Example daily experience:
- 27 positions clear today
- 3 positions need attention
- `AAPL`: large price move, escalation recommended
- `TSM`: earnings out, probably unchanged but review needed
- `NFLX`: original short holding window expired, reconsider thesis

This gives the user a stable feeling:
- the portfolio is being watched
- unchanged positions are not noisy
- changed positions are explained
- action comes with reasons

## Core flows

### 1. Bootstrap deep dive
- user submits portfolio
- backend creates position state and strategy scaffolding
- deep-dive jobs build the first high-quality strategy set
- each strategy becomes the long-lived source of truth for the position

### 2. Daily brief
- backend scheduler triggers the daily run
- backend checks catalysts, freshness, price action, and important events
- positions are classified into:
  - clear
  - monitor
  - escalate
- only escalated positions are sent into deep dive
- user receives a concise daily picture first

### 3. Quick check
- lightweight, cheap review of one position
- mostly deterministic checks plus small bounded reasoning
- used to decide whether a deep dive is needed now

### 4. Deep dive
- expensive, multi-angle research path
- updates strategy, verdict, catalysts, and reasoning
- creates the detailed report the user can act on

### 5. Weekly review
- slower, calmer portfolio coverage
- tiered by user plan
- lower tiers may cover top positions
- higher tiers may cover the full portfolio

## Product principles

- backend owns scheduling, job state, delivery, and observability
- agents are used for bounded research work, not for product control flow
- strategy files are durable and strong, but interfaces around them must remain replaceable
- duplicate legacy protocols are removed when they interfere with reliability or cost
- notifications are unified across channels
- cost explosions are treated as product bugs

## Architecture in practice

There are four main surfaces:
- `backend/`: orchestration, state, jobs, scheduling, notifications, observability
- `frontend/`: dashboard experience
- `shared/user-workspace/`: user-space prompt files that are copied into each user workspace
- `skills/`: shared read-only skill library

The backend should be the source of truth.
Reports, prompts, and notifications should derive from backend-owned state, not compete with it.

## What “working well” means

Clawd is working well when:
- most positions do not trigger unnecessary expensive work
- deep dives happen only when justified
- every expensive request is attributable
- users get dependable daily clarity
- verdicts are practical and explained
- notifications arrive through the chosen channel
- a bug cannot silently generate runaway LLM cost
