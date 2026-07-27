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
| Market data | Mock · **Upstox / 5paisa / Angel (free)** · Zerodha |
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

## Free live data (you already have Upstox + 5paisa)

Orders stay **PAPER**. Only market prices come from the broker.

### Option A — Upstox (recommended)

1. Create an API app at [Upstox Developer Apps](https://account.upstox.com/developer/apps)  
2. Set Redirect URI exactly to: `http://127.0.0.1:4000/api/upstox/callback`  
3. Put key/secret in `backend/.env`:

```env
UPSTOX_API_KEY=...
UPSTOX_API_SECRET=...
UPSTOX_REDIRECT_URI=http://127.0.0.1:4000/api/upstox/callback
```

4. Restart backend, then open: http://localhost:4000/api/upstox/login  
5. After login, copy `UPSTOX_ACCESS_TOKEN` from the page/terminal into `.env`  
6. Set `MARKET_DATA_PROVIDER=upstox` and restart  

Dashboard badge → **Upstox feed**

### Option B — 5paisa

1. Get access token from [Xstream / 5paisa API](https://xstream.5paisa.com/)  
2. In `.env`:

```env
MARKET_DATA_PROVIDER=fivepaisa
FIVEPAISA_ACCESS_TOKEN=...
FIVEPAISA_CLIENT_CODE=your_client_code
```

3. Restart — badge → **5paisa feed**

### Option C — Angel One

See Angel section below.

## Angel One SmartAPI (free live data)

Best free option for real NSE quotes during market hours.

1. Open / use an [Angel One](https://www.angelone.in/) trading account  
2. Create an API app at [https://smartapi.angelone.in/](https://smartapi.angelone.in/)  
3. Enable **TOTP** in the Angel app and copy the **secret key** (long base32 string — not the 6-digit code)  
4. Put credentials in `backend/.env`:

```env
MARKET_DATA_PROVIDER=angel
ANGEL_API_KEY=your_api_key
ANGEL_CLIENT_CODE=your_client_id
ANGEL_PASSWORD=your_pin
ANGEL_TOTP_SECRET=your_totp_secret
```

5. Restart: `npm run dev`  
6. Dashboard badge should show **Angel feed** (still **PAPER** orders)

If login fails, TradePilot automatically falls back to **mock**.

> Off-market hours: Angel returns last available prices / prior session candles — not fake random walks.

## Optional OpenAI

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
AI_FILTER_ENABLED=true
```

## Zerodha (optional / later)

1. Paper trade extensively with Angel or mock and review explanations / PnL  
2. Set `MARKET_DATA_PROVIDER=zerodha` and wire `KiteTicker` in `backend/src/market/provider.ts`  
3. Wire `kiteconnect` in `backend/src/broker/index.ts`  
4. Only then enable live order flags  

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
 ├── Market Data (mock | Upstox | 5paisa | Angel | Zerodha)
 ├── Indicator Engine (EMA, RSI, VWAP, ATR)
 ├── Decision Engine (strategy)
 ├── AI Agent (trade filter + explanation)
 ├── Paper / Live Broker
└── PostgreSQL
```
