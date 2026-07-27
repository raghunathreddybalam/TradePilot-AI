import { OrderMode, TradeSide, TradeStatus, type Instrument } from "@prisma/client";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { filterTradeWithAi } from "../ai/filter.js";
import { paperBroker, getActiveBroker } from "../broker/index.js";
import { evaluateStrategy } from "../decision/strategy.js";
import { computeIndicators } from "../indicators/engine.js";
import type { OhlcvBar, Tick, TradeDecision } from "../types/market.js";
import type { MarketDataProvider } from "../market/provider.js";

interface PrevState {
  ema5: number | null;
  close: number | null;
}

/**
 * Orchestrates: market ticks → indicators → strategy → AI filter → paper/live order.
 */
export class TradingEngine {
  private prev = new Map<string, PrevState>();
  private instruments = new Map<string, Instrument>();
  private lastSignalAt = new Map<string, number>();
  private readonly cooldownMs = 5 * 60_000; // avoid signal spam

  constructor(private market: MarketDataProvider) {}

  async initialize(symbols: string[]) {
    const rows = await prisma.instrument.findMany({
      where: { symbol: { in: symbols }, isActive: true },
    });
    for (const row of rows) this.instruments.set(row.symbol, row);

    // Ensure account snapshot exists
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

    this.market.onTick((tick) => {
      void this.onTick(tick);
    });
  }

  private async onTick(tick: Tick) {
    paperBroker.setPrice(tick.symbol, tick.price);
    await this.markOpenPositions(tick);

    // Evaluate on each new minute boundary roughly — throttle by cooldown + second==0-ish
    const instrument = this.instruments.get(tick.symbol);
    if (!instrument) return;

    const last = this.lastSignalAt.get(tick.symbol) ?? 0;
    if (Date.now() - last < 15_000) return; // evaluate at most every 15s per symbol

    const bars = await this.market.getHistory(tick.symbol, 1, 100);
    if (bars.length < 30) return;

    await this.evaluateSymbol(instrument, bars);
  }

  async evaluateSymbol(instrument: Instrument, bars: OhlcvBar[]) {
    const indicators = computeIndicators(bars);
    const prev = this.prev.get(instrument.symbol);
    const decision = evaluateStrategy({
      symbol: instrument.symbol,
      indicators,
      prevEma5: prev?.ema5,
      prevClose: prev?.close,
    });

    this.prev.set(instrument.symbol, {
      ema5: indicators.ema5,
      close: indicators.close,
    });

    if (decision.action !== "BUY" && decision.action !== "SELL") {
      return;
    }

    const last = this.lastSignalAt.get(instrument.symbol) ?? 0;
    if (Date.now() - last < this.cooldownMs) return;
    this.lastSignalAt.set(instrument.symbol, Date.now());

    const ai = await filterTradeWithAi(instrument.symbol, decision);

    const signal = await prisma.signal.create({
      data: {
        instrumentId: instrument.id,
        action: decision.action,
        confidence: decision.confidence,
        price: indicators.close,
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
  }

  private async execute(instrument: Instrument, decision: TradeDecision, signalId: string) {
    const mode = env.TRADING_MODE === "LIVE" ? OrderMode.LIVE : OrderMode.PAPER;
    const quantity = decision.quantity ?? Math.max(1, instrument.lotSize);
    const broker = getActiveBroker();

    const explanation = [
      decision.reason,
      `AI filter approved.`,
      `SL=${decision.stopLoss ?? "n/a"} TP=${decision.takeProfit ?? "n/a"}`,
      `Mode=${mode}`,
    ].join(" ");

    const result = await broker.placeOrder({
      symbol: instrument.symbol,
      side: decision.action as "BUY" | "SELL",
      quantity,
      price: decision.indicators.close,
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

    await prisma.trade.create({
      data: {
        instrumentId: instrument.id,
        signalId,
        side: decision.action as TradeSide,
        status: TradeStatus.OPEN,
        mode,
        quantity,
        entryPrice: result.averagePrice,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        explanation,
        brokerOrderId: result.orderId,
        openedAt: new Date(),
      },
    });

    console.log(`[engine] ${mode} ${decision.action} ${instrument.symbol} @ ${result.averagePrice}`);
  }

  /** Check SL/TP on open paper trades */
  private async markOpenPositions(tick: Tick) {
    const instrument = this.instruments.get(tick.symbol);
    if (!instrument) return;

    const openTrades = await prisma.trade.findMany({
      where: {
        instrumentId: instrument.id,
        status: TradeStatus.OPEN,
        mode: OrderMode.PAPER,
      },
    });

    for (const trade of openTrades) {
      if (trade.entryPrice == null) continue;
      let shouldClose = false;
      let exit = tick.price;

      if (trade.side === TradeSide.BUY) {
        if (trade.stopLoss != null && tick.price <= trade.stopLoss) {
          shouldClose = true;
          exit = trade.stopLoss;
        } else if (trade.takeProfit != null && tick.price >= trade.takeProfit) {
          shouldClose = true;
          exit = trade.takeProfit;
        }
      } else {
        if (trade.stopLoss != null && tick.price >= trade.stopLoss) {
          shouldClose = true;
          exit = trade.stopLoss;
        } else if (trade.takeProfit != null && tick.price <= trade.takeProfit) {
          shouldClose = true;
          exit = trade.takeProfit;
        }
      }

      if (!shouldClose) continue;

      const pnl =
        trade.side === TradeSide.BUY
          ? (exit - trade.entryPrice) * trade.quantity
          : (trade.entryPrice - exit) * trade.quantity;
      const pnlPercent = (pnl / (trade.entryPrice * trade.quantity)) * 100;

      await prisma.trade.update({
        where: { id: trade.id },
        data: {
          status: TradeStatus.CLOSED,
          exitPrice: exit,
          pnl,
          pnlPercent,
          closedAt: new Date(),
          explanation: `${trade.explanation} | Closed @ ${exit} PnL=${pnl.toFixed(2)}`,
        },
      });
    }
  }
}
