import { OrderMode, TradeSide, TradeStatus, type Instrument, type Trade } from "@prisma/client";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { CANDLE_INTERVAL_MINUTES } from "../config/timeframe.js";
import { filterTradeWithAi } from "../ai/filter.js";
import { paperBroker, getActiveBroker } from "../broker/index.js";
import { evaluateStrategy } from "../decision/strategy.js";
import { favorablePoints, trailedStopLoss, trailStepForSymbol } from "../decision/trailingStop.js";
import { computeIndicators } from "../indicators/engine.js";
import type { OhlcvBar, Tick, TradeDecision } from "../types/market.js";
import type { MarketDataProvider } from "../market/provider.js";

/**
 * Orchestrates: market ticks → indicators → strategy → AI filter → paper/live order.
 * SQLite-safe: in-memory open-trade cache + serialized DB writes.
 */
export class TradingEngine {
  private instruments = new Map<string, Instrument>();
  private lastEvalAt = new Map<string, number>();
  private lastSignalAt = new Map<string, number>();
  private openBySymbol = new Map<string, Trade[]>();
  /** Original setup SL — trailing must not lose this reference */
  private initialStopByTradeId = new Map<string, number>();
  private busySymbols = new Set<string>();
  private dbQueue: Promise<void> = Promise.resolve();
  private readonly evalEveryMs = 30_000;
  /** One signal per completed 5m candle window */
  private readonly cooldownMs = CANDLE_INTERVAL_MINUTES * 60_000;

  constructor(private market: MarketDataProvider) {}

  async initialize(symbols: string[]) {
    const rows = await prisma.instrument.findMany({
      where: { symbol: { in: symbols }, isActive: true },
    });
    for (const row of rows) this.instruments.set(row.symbol, row);

    const mode = env.TRADING_MODE === "LIVE" ? OrderMode.LIVE : OrderMode.PAPER;
    const latest = await prisma.accountSnapshot.findFirst({
      where: { mode },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) {
      await prisma.accountSnapshot.create({
        data: {
          mode,
          equity: env.PAPER_STARTING_EQUITY,
          cash: env.PAPER_STARTING_EQUITY,
        },
      });
    }

    await this.refreshOpenCache();

    this.market.onTick((tick) => {
      void this.onTick(tick).catch((err) => {
        console.error(`[engine] tick error ${tick.symbol}:`, err);
      });
    });
  }

  private enqueueDb<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.dbQueue.then(fn, fn);
    this.dbQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async refreshOpenCache() {
    const mode = env.TRADING_MODE === "LIVE" ? OrderMode.LIVE : OrderMode.PAPER;
    const open = await prisma.trade.findMany({
      where: { status: TradeStatus.OPEN, mode },
    });
    this.openBySymbol.clear();
    this.initialStopByTradeId.clear();
    for (const trade of open) {
      const inst = [...this.instruments.values()].find((i) => i.id === trade.instrumentId);
      if (!inst) continue;
      const list = this.openBySymbol.get(inst.symbol) ?? [];
      list.push(trade);
      this.openBySymbol.set(inst.symbol, list);
      if (trade.stopLoss != null) {
        this.initialStopByTradeId.set(trade.id, trade.stopLoss);
      }
    }
  }

  private async onTick(tick: Tick) {
    paperBroker.setPrice(tick.symbol, tick.price);
    this.checkStopsInMemory(tick);

    const instrument = this.instruments.get(tick.symbol);
    if (!instrument) return;

    const last = this.lastEvalAt.get(tick.symbol) ?? 0;
    if (Date.now() - last < this.evalEveryMs) return;
    if (this.busySymbols.has(tick.symbol)) return;

    this.busySymbols.add(tick.symbol);
    this.lastEvalAt.set(tick.symbol, Date.now());

    try {
      const bars = await this.market.getHistory(tick.symbol, CANDLE_INTERVAL_MINUTES, 100);
      if (bars.length < 30) return;
      await this.evaluateSymbol(instrument, bars);
    } finally {
      this.busySymbols.delete(tick.symbol);
    }
  }

  async evaluateSymbol(instrument: Instrument, bars: OhlcvBar[]) {
    const indicators = computeIndicators(bars);
    const decision = evaluateStrategy({
      symbol: instrument.symbol,
      indicators,
      bars,
    });

    if (decision.action !== "BUY" && decision.action !== "SELL") return;

    const last = this.lastSignalAt.get(instrument.symbol) ?? 0;
    if (Date.now() - last < this.cooldownMs) return;
    this.lastSignalAt.set(instrument.symbol, Date.now());

    const ai = await filterTradeWithAi(instrument.symbol, decision);
    const signalPrice = decision.entryPrice ?? indicators.close;

    await this.enqueueDb(async () => {
      const signal = await prisma.signal.create({
        data: {
          instrumentId: instrument.id,
          action: decision.action,
          confidence: decision.confidence,
          price: signalPrice,
          reason: decision.reason,
          indicators: indicators as object,
          aiVerdict: ai.verdict,
          aiReason: ai.reason,
          aiScore: ai.score,
        },
      });

      if (!ai.approved) {
        console.log(`[engine] AI rejected ${instrument.symbol}: ${ai.reason}`);
        return;
      }

      await this.execute(instrument, decision, signal.id);
    });
  }

  private async execute(instrument: Instrument, decision: TradeDecision, signalId: string) {
    const mode = env.TRADING_MODE === "LIVE" ? OrderMode.LIVE : OrderMode.PAPER;
    // Paper: always 1 unit so ₹50k account stays simple (indices lots are huge)
    const quantity = decision.quantity ?? 1;
    const broker = getActiveBroker();

    const explanation = [
      decision.reason,
      `AI filter approved.`,
      `SL=${decision.stopLoss ?? "n/a"} trail every ${trailStepForSymbol(instrument.symbol)}pts (no fixed TP)`,
      `Mode=${mode}`,
    ].join(" ");

    const fillPrice = decision.entryPrice ?? decision.indicators.close;

    const result = await broker.placeOrder({
      symbol: instrument.symbol,
      side: decision.action as "BUY" | "SELL",
      quantity,
      price: fillPrice,
      orderType: "MARKET",
      tag: signalId,
    });

    if (!result.success) {
      await prisma.trade.create({
        data: {
          instrumentId: instrument.id,
          signalId,
          side: decision.action as TradeSide,
          status: TradeStatus.REJECTED,
          mode,
          quantity,
          explanation: `${explanation} | Broker: ${result.message}`,
        },
      });
      return;
    }

    const trade = await prisma.trade.create({
      data: {
        instrumentId: instrument.id,
        signalId,
        side: decision.action as TradeSide,
        status: TradeStatus.OPEN,
        mode,
        quantity,
        entryPrice: result.averagePrice,
        stopLoss: decision.stopLoss,
        takeProfit: null,
        explanation,
        brokerOrderId: result.orderId,
        openedAt: new Date(),
      },
    });

    const list = this.openBySymbol.get(instrument.symbol) ?? [];
    list.push(trade);
    this.openBySymbol.set(instrument.symbol, list);
    if (decision.stopLoss != null) {
      this.initialStopByTradeId.set(trade.id, decision.stopLoss);
    }

    console.log(`[engine] ${mode} ${decision.action} ${instrument.symbol} @ ${result.averagePrice}`);
  }

  /** SL/TP checks against in-memory open trades — no DB on every tick */
  private checkStopsInMemory(tick: Tick) {
    const openTrades = this.openBySymbol.get(tick.symbol);
    if (!openTrades?.length) return;

    const stillOpen: Trade[] = [];
    for (const trade of openTrades) {
      if (trade.entryPrice == null) {
        stillOpen.push(trade);
        continue;
      }

      const entry = trade.entryPrice;
      const side = trade.side === TradeSide.BUY ? "BUY" : "SELL";
      const originalSl =
        this.initialStopByTradeId.get(trade.id) ?? trade.stopLoss ?? undefined;

      if (originalSl != null) {
        const fav = favorablePoints(side, entry, tick.price);
        const step = trailStepForSymbol(tick.symbol);
        const trailed = trailedStopLoss(side, entry, originalSl, fav, step);
        if (trade.stopLoss == null || (side === "SELL" ? trailed < trade.stopLoss : trailed > trade.stopLoss)) {
          trade.stopLoss = trailed;
          void this.enqueueDb(async () => {
            await prisma.trade.update({
              where: { id: trade.id },
              data: { stopLoss: trailed },
            });
          }).catch((err) => console.error("[engine] trail SL update failed", err));
        }
      }

      const currentSl = trade.stopLoss;
      let shouldClose = false;
      let exit = tick.price;
      let closeLabel = "Closed";

      if (side === "BUY") {
        if (currentSl != null && tick.price <= currentSl) {
          shouldClose = true;
          exit = currentSl;
          closeLabel =
            originalSl != null && currentSl !== originalSl ? "Trail SL" : "Stop-loss";
        } else if (trade.takeProfit != null && tick.price >= trade.takeProfit) {
          shouldClose = true;
          exit = trade.takeProfit;
          closeLabel = "Target";
        }
      } else {
        if (currentSl != null && tick.price >= currentSl) {
          shouldClose = true;
          exit = currentSl;
          closeLabel =
            originalSl != null && currentSl !== originalSl ? "Trail SL" : "Stop-loss";
        } else if (trade.takeProfit != null && tick.price <= trade.takeProfit) {
          shouldClose = true;
          exit = trade.takeProfit;
          closeLabel = "Target";
        }
      }

      if (!shouldClose) {
        stillOpen.push(trade);
        continue;
      }

      this.initialStopByTradeId.delete(trade.id);

      const pnl =
        side === "BUY" ? (exit - entry) * trade.quantity : (entry - exit) * trade.quantity;
      const pnlPercent = (pnl / (entry * trade.quantity)) * 100;

      void this.enqueueDb(async () => {
        await prisma.trade.update({
          where: { id: trade.id },
          data: {
            status: TradeStatus.CLOSED,
            exitPrice: exit,
            stopLoss: currentSl,
            pnl,
            pnlPercent,
            closedAt: new Date(),
            explanation: `${trade.explanation} | ${closeLabel} @ ${exit} PnL=${pnl.toFixed(2)}`,
          },
        });
        console.log(`[engine] CLOSED ${tick.symbol} ${closeLabel} @ ${exit} PnL=${pnl.toFixed(2)}`);
      }).catch((err) => console.error("[engine] close trade failed", err));
    }

    this.openBySymbol.set(tick.symbol, stillOpen);
  }
}
