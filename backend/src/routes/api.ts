import { Router } from "express";
import { OrderMode, TradeStatus } from "@prisma/client";
import { prisma } from "../config/db.js";
import { env, isLiveTradingAllowed, WATCHLIST_SYMBOLS } from "../config/env.js";
import { computeIndicators, computeIndicatorSeries } from "../indicators/engine.js";
import type { MarketDataProvider } from "../market/provider.js";

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
        const bars = await market.getHistory(inst.symbol, 1, 2);
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
    const bars = await market.getHistory(symbol, 1, count);
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
      where: status ? { status } : undefined,
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

  router.get("/config", (_req, res) => {
    res.json({
      tradingMode: env.TRADING_MODE,
      liveTradingEnabled: env.LIVE_TRADING_ENABLED === true,
      liveAllowed: isLiveTradingAllowed(),
      watchlist: WATCHLIST_SYMBOLS,
      aiFilterEnabled: env.AI_FILTER_ENABLED,
      mockMarketData: market.name === "mock",
    });
  });

  return router;
}
