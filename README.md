# TradePilot AI

Paper-first trading desk for **NIFTY**, **BANKNIFTY**, and NSE stocks.

React dashboard → Express backend → Market data → Indicator engine → Decision engine → AI filter → Paper broker (Zerodha later).

## Stack

| Part | Technology |
|------|------------|
| Frontend | React + Vite + TradingView Lightweight Charts |
| Backend | Express + TypeScript |
| Database | SQLite (local) / PostgreSQL (prod) + Prisma |
| AI | OpenAI API (heuristic fallback if no key) |
| Scheduler | node-cron |
| Market data | Mock feed now · Zerodha Kite Connect ready |
| Real-time | WebSockets |

## Safety model

1. Default mode is **PAPER**
2. Live Zerodha orders require **all** of:
   - `TRADING_MODE=LIVE`
   - `LIVE_TRADING_ENABLED=true`
   - Valid `KITE_API_KEY` + `KITE_ACCESS_TOKEN`
3. Live `placeOrder` is intentionally stubbed until paper results look solid

## Quick start

```bash
# 1. Install
npm install

# 2. Env (SQLite by default — no Docker required)
cp backend/.env.example backend/.env

# 3. Schema + seed
npm run db:push
npm run db:seed

# 4. Run both apps
npm run dev
```

> **Database:** local default is **SQLite** (`backend/prisma/dev.db`) so you can paper trade immediately.  
> When Docker is available, switch Prisma `provider` to `postgresql` and run `docker compose up -d` (see `.env.example`).

- Dashboard: http://localhost:5173  
- API: http://localhost:4000/api/health  
- WebSocket: ws://localhost:4000/ws  

## What runs out of the box

- Live **mock** ticks for NIFTY 50, NIFTY BANK, RELIANCE, TCS, INFY, HDFCBANK
- Indicators: **EMA5 / EMA9 / EMA21**, **RSI(14)**, **VWAP**, **ATR(14)**
- Strategy: VWAP + EMA confluence with RSI band
- AI filter: OpenAI when keyed; otherwise rule-based reject of weak/extreme setups
- Paper fills with stop-loss / take-profit management
- Dashboard shows watchlist, chart overlays, signal verdicts, and full trade explanations

## Optional OpenAI

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
AI_FILTER_ENABLED=true
```

## Zerodha (later)

1. Paper trade extensively and review explanations / PnL
2. Set `USE_MOCK_MARKET_DATA=false` and wire `KiteTicker` in `backend/src/market/provider.ts`
3. Wire `kiteconnect` in `backend/src/broker/index.ts`
4. Only then enable live flags above

## Useful scripts

```bash
npm run dev              # backend + frontend
npm run dev:backend
npm run dev:frontend
npm run db:push
npm run db:seed
npm run test -w backend  # indicator unit tests
```

## Architecture

```
React Dashboard
      │
      ▼
Node.js Backend
 ├── Market Data (mock | Zerodha)
 ├── Indicator Engine (EMA, RSI, VWAP, ATR)
 ├── Decision Engine (strategy)
 ├── AI Agent (trade filter + explanation)
 ├── Paper / Live Broker
└── PostgreSQL
```
