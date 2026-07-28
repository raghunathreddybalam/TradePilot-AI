import { Router } from "express";
import { OrderMode, TradeStatus } from "@prisma/client";
import { prisma } from "../config/db.js";
import { env, isLiveTradingAllowed, WATCHLIST_SYMBOLS } from "../config/env.js";
import { backtestSymbol } from "../services/backtest.js";
import { enrichBacktestSummary, getAtmPeQuote } from "../services/optionPnl.js";
import { backtestMonthAllCached, backtestMonthCached } from "../services/monthlyCache.js";
import { CANDLE_INTERVAL_MINUTES } from "../config/timeframe.js";
import { computeIndicators, computeIndicatorSeries } from "../indicators/engine.js";
import type { MarketDataProvider } from "../market/provider.js";
import {
  buildUpstoxLoginUrl,
  exchangeUpstoxCode,
  hasUpstoxOAuthApp,
} from "../market/upstoxClient.js";

function startOfTodayIst(): Date {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(`${ymd}T00:00:00+05:30`);
}

export function createApiRouter(market: MarketDataProvider) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      tradingMode: env.TRADING_MODE,
      liveAllowed: isLiveTradingAllowed(),
      marketProvider: market.name,
      aiFilter: env.AI_FILTER_ENABLED,
      time: new Date().toISOString(),
    });
  });

  router.get("/instruments", async (_req, res) => {
    const instruments = await prisma.instrument.findMany({
      where: { isActive: true },
      orderBy: { symbol: "asc" },
    });
    res.json(instruments);
  });

  router.get("/watchlist", async (_req, res) => {
    const instruments = await prisma.instrument.findMany({
      where: { symbol: { in: WATCHLIST_SYMBOLS }, isActive: true },
    });
    const quotes = await Promise.all(
      instruments.map(async (inst) => {
        const bars = await market.getHistory(inst.symbol, CANDLE_INTERVAL_MINUTES, 2);
        const last = bars[bars.length - 1];
        const prev = bars[bars.length - 2];
        const price = last?.close ?? 0;
        const change = prev ? price - prev.close : 0;
        const changePercent = prev && prev.close ? (change / prev.close) * 100 : 0;
        return {
          symbol: inst.symbol,
          name: inst.name,
          instrumentType: inst.instrumentType,
          price,
          change,
          changePercent,
        };
      }),
    );
    res.json(quotes);
  });

  router.get("/candles/:symbol", async (req, res) => {
    const symbol = decodeURIComponent(req.params.symbol);
    const count = Math.min(Number(req.query.count) || 120, 500);
    const raw = await market.getHistory(symbol, CANDLE_INTERVAL_MINUTES, count);
    // Ascending unique timestamps required by Lightweight Charts
    const byTs = new Map<number, (typeof raw)[number]>();
    for (const b of raw) {
      byTs.set(b.timestamp.getTime(), b);
    }
    const bars = [...byTs.values()]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(-count);

    const series = computeIndicatorSeries(bars);
    const snapshot = computeIndicators(bars);

    res.json({
      symbol,
      bars: bars.map((b) => ({
        time: Math.floor(b.timestamp.getTime() / 1000),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      indicators: {
        snapshot,
        ema5: series.ema5.map((v, i) =>
          v == null ? null : { time: Math.floor(bars[i]!.timestamp.getTime() / 1000), value: v },
        ),
        ema21: series.ema21.map((v, i) =>
          v == null ? null : { time: Math.floor(bars[i]!.timestamp.getTime() / 1000), value: v },
        ),
        vwap: series.vwap.map((v, i) =>
          v == null ? null : { time: Math.floor(bars[i]!.timestamp.getTime() / 1000), value: v },
        ),
        rsi14: series.rsi14.map((v, i) =>
          v == null ? null : { time: Math.floor(bars[i]!.timestamp.getTime() / 1000), value: v },
        ),
      },
    });
  });

  router.get("/signals", async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const signals = await prisma.signal.findMany({
      where: { createdAt: { gte: startOfTodayIst() } },
      take,
      orderBy: { createdAt: "desc" },
      include: { instrument: true, trade: true },
    });
    res.json(signals);
  });

  router.get("/trades", async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const status = req.query.status as TradeStatus | undefined;
    const trades = await prisma.trade.findMany({
      where: {
        createdAt: { gte: startOfTodayIst() },
        ...(status ? { status } : {}),
      },
      take,
      orderBy: { createdAt: "desc" },
      include: { instrument: true, signal: true },
    });
    res.json(trades);
  });

  router.get("/account", async (_req, res) => {
    const mode = env.TRADING_MODE === "LIVE" ? OrderMode.LIVE : OrderMode.PAPER;
    const openTrades = await prisma.trade.findMany({
      where: { status: TradeStatus.OPEN, mode },
      include: { instrument: true },
    });
    const closed = await prisma.trade.findMany({
      where: { status: TradeStatus.CLOSED, mode },
    });
    const realizedPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const cash = env.PAPER_STARTING_EQUITY + realizedPnl;
    const openNotional = openTrades.reduce(
      (s, t) => s + (t.entryPrice ?? 0) * t.quantity,
      0,
    );

    res.json({
      mode,
      startingEquity: env.PAPER_STARTING_EQUITY,
      cash,
      openNotional,
      realizedPnl,
      openTrades: openTrades.length,
      closedTrades: closed.length,
      positions: openTrades,
    });
  });

  router.get("/backtest/:symbol", async (req, res) => {
    const symbol = decodeURIComponent(req.params.symbol);
    const count = Math.min(Number(req.query.count) || 200, 500);
    const bars = await market.getHistory(symbol, CANDLE_INTERVAL_MINUTES, count);
    const summary = backtestSymbol(symbol, bars, CANDLE_INTERVAL_MINUTES);
    res.json(await enrichBacktestSummary(summary));
  });

  router.get("/backtest", async (_req, res) => {
    const results = await Promise.all(
      WATCHLIST_SYMBOLS.map(async (symbol) => {
        const bars = await market.getHistory(symbol, CANDLE_INTERVAL_MINUTES, 200);
        return enrichBacktestSummary(backtestSymbol(symbol, bars, CANDLE_INTERVAL_MINUTES));
      }),
    );

    const totals = results.reduce(
      (acc, r) => {
        acc.ordersTriggered += r.ordersTriggered;
        acc.stopLossHit += r.stopLossHit;
        acc.trailStopHit += r.trailStopHit;
        acc.stillOpen += r.stillOpen;
        if (r.optionPnlInrTotal != null) {
          acc.optionPnlInrTotal = (acc.optionPnlInrTotal ?? 0) + r.optionPnlInrTotal;
        }
        return acc;
      },
      {
        ordersTriggered: 0,
        stopLossHit: 0,
        trailStopHit: 0,
        stillOpen: 0,
        optionPnlInrTotal: null as number | null,
      },
    );
    const closed = totals.stopLossHit + totals.trailStopHit;
    const winners = results
      .flatMap((r) => r.orders)
      .filter((o) => o.exitReason !== "OPEN" && (o.pnlPoints ?? 0) > 0).length;

    res.json({
      timeframeMinutes: CANDLE_INTERVAL_MINUTES,
      trailStepPointsBySymbol: Object.fromEntries(
        results.map((r) => [r.symbol, r.trailStepPoints]),
      ),
      totals: {
        ...totals,
        winRate: closed > 0 ? Math.round((winners / closed) * 10000) / 100 : null,
      },
      bySymbol: results,
    });
  });

  /** Live ATM (or strike) PE quote for current weekly expiry */
  router.get("/options/:symbol/pe", async (req, res) => {
    try {
      const symbol = decodeURIComponent(req.params.symbol);
      const strike = req.query.strike ? Number(req.query.strike) : undefined;
      const quote = await getAtmPeQuote(symbol, Number.isFinite(strike) ? strike : undefined);
      if (!quote) {
        res.status(503).json({
          error: "Option quote unavailable — need Upstox token / market hours",
        });
        return;
      }
      res.json(quote);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Option quote failed",
      });
    }
  });

  /** Last ~1 month day-by-day strategy + day-open ATM PE P&L */
  router.get("/backtest-month/:symbol", async (req, res) => {
    try {
      const symbol = decodeURIComponent(req.params.symbol);
      const mode = req.query.mode === "rr4" ? "rr4" : "trail";
      const summary = await backtestMonthCached(symbol, mode);
      res.json(summary);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Monthly backtest failed",
      });
    }
  });

  router.get("/backtest-month", async (req, res) => {
    try {
      const mode = req.query.mode === "rr4" ? "rr4" : "trail";
      res.json(await backtestMonthAllCached(mode));
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Monthly backtest failed",
      });
    }
  });

  /** Side-by-side trail vs 1:4 for last month */
  router.get("/backtest-month-compare", async (_req, res) => {
    try {
      const trail = await backtestMonthAllCached("trail");
      const rr4 = await backtestMonthAllCached("rr4");
      res.json({ trail, rr4 });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Compare backtest failed",
      });
    }
  });

  router.get("/config", (_req, res) => {
    res.json({
      tradingMode: env.TRADING_MODE,
      liveTradingEnabled: env.LIVE_TRADING_ENABLED === true,
      liveAllowed: isLiveTradingAllowed(),
      watchlist: WATCHLIST_SYMBOLS,
      aiFilterEnabled: env.AI_FILTER_ENABLED,
      marketProvider: market.name,
      mockMarketData: market.name === "mock",
      candleIntervalMinutes: CANDLE_INTERVAL_MINUTES,
    });
  });

  /** Upstox OAuth — open this after setting UPSTOX_API_KEY/SECRET/REDIRECT_URI */
  router.get("/upstox/login", (_req, res) => {
    try {
      if (!hasUpstoxOAuthApp()) {
        res.status(400).json({
          error:
            "Set UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI in backend/.env first",
        });
        return;
      }
      res.redirect(buildUpstoxLoginUrl());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "login failed" });
    }
  });

  router.get("/upstox/callback", async (req, res) => {
    try {
      const code = String(req.query.code ?? "");
      if (!code) {
        res.status(400).send("Missing ?code= from Upstox");
        return;
      }
      const token = await exchangeUpstoxCode(code);
      console.log("\n========== UPSTOX ACCESS TOKEN ==========");
      console.log(token);
      console.log("Paste into backend/.env as UPSTOX_ACCESS_TOKEN=...");
      console.log("Set MARKET_DATA_PROVIDER=upstox then restart.");
      console.log("=========================================\n");
      res.type("html").send(`<!doctype html>
<html><body style="font-family:sans-serif;padding:2rem;max-width:720px">
  <h1>Upstox login OK</h1>
  <p>Access token was printed in the <strong>backend terminal</strong>.</p>
  <ol>
    <li>Copy <code>UPSTOX_ACCESS_TOKEN=...</code> into <code>backend/.env</code></li>
    <li>Set <code>MARKET_DATA_PROVIDER=upstox</code></li>
    <li>Restart <code>npm run dev</code></li>
  </ol>
  <p>Token (also in terminal):</p>
  <textarea style="width:100%;height:120px">${token}</textarea>
</body></html>`);
    } catch (err) {
      res.status(500).send(err instanceof Error ? err.message : "callback failed");
    }
  });

  return router;
}
