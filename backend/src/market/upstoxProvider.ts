import { EventEmitter } from "node:events";
import type { OhlcvBar, Tick } from "../types/market.js";
import type { MarketDataProvider } from "./provider.js";
import { env } from "../config/env.js";
import { CANDLE_INTERVAL_MINUTES, floorToCandleBucket } from "../config/timeframe.js";
import { UpstoxClient, hasUpstoxCredentials } from "./upstoxClient.js";
import { resolveUpstox, type UpstoxInstrument } from "./brokerInstruments.js";

/**
 * Upstox free market-data provider (paper trading only).
 * Candles use 5-minute timeframe.
 */
export class UpstoxMarketDataProvider extends EventEmitter implements MarketDataProvider {
  readonly name = "upstox";
  private client!: UpstoxClient;
  private pollTimer: NodeJS.Timeout | null = null;
  private instruments = new Map<string, UpstoxInstrument>();
  private keyToSymbol = new Map<string, string>();
  private histories = new Map<string, OhlcvBar[]>();
  private candleBuilders = new Map<string, OhlcvBar>();

  async start(symbols: string[]): Promise<void> {
    if (!hasUpstoxCredentials()) {
      throw new Error("UPSTOX_ACCESS_TOKEN missing in backend/.env");
    }

    this.client = new UpstoxClient(env.UPSTOX_ACCESS_TOKEN!);

    for (const symbol of symbols) {
      const inst = resolveUpstox(symbol);
      if (!inst) {
        console.warn(`[upstox] No instrument key for ${symbol} — skipped`);
        continue;
      }
      this.instruments.set(symbol, inst);
      this.keyToSymbol.set(inst.instrumentKey, symbol);
    }

    await this.bootstrapHistories();

    this.pollTimer = setInterval(() => {
      void this.pollLtp().catch((err) => console.error("[upstox] poll error", err));
    }, 1100);

    console.log(
      `[upstox] Streaming ${this.instruments.size} symbols (${CANDLE_INTERVAL_MINUTES}m candles)`,
    );
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async getHistory(symbol: string, _intervalMinutes: number, count: number): Promise<OhlcvBar[]> {
    const hist = this.histories.get(symbol) ?? [];
    if (hist.length < Math.min(count, 30)) {
      try {
        await this.fetchHistory(symbol);
      } catch (err) {
        console.warn(`[upstox] history refresh failed for ${symbol}`, err);
      }
    }
    return (this.histories.get(symbol) ?? []).slice(-count);
  }

  onTick(handler: (tick: Tick) => void): void {
    this.on("tick", handler);
  }

  offTick(handler: (tick: Tick) => void): void {
    this.off("tick", handler);
  }

  private async bootstrapHistories() {
    for (const symbol of this.instruments.keys()) {
      try {
        await this.fetchHistory(symbol);
      } catch (err) {
        console.warn(`[upstox] bootstrap history failed for ${symbol}:`, err);
        this.histories.set(symbol, []);
      }
    }
  }

  private async fetchHistory(symbol: string) {
    const inst = this.instruments.get(symbol);
    if (!inst) return;

    let rows = await this.client.getIntradayCandles(
      inst.instrumentKey,
      CANDLE_INTERVAL_MINUTES,
    );

    if (rows.length < 30) {
      const to = new Date();
      const from = new Date(to.getTime() - 5 * 24 * 60 * 60_000);
      const toStr = to.toISOString().slice(0, 10);
      const fromStr = from.toISOString().slice(0, 10);
      rows = await this.client.getHistoricalCandles(
        inst.instrumentKey,
        fromStr,
        toStr,
        CANDLE_INTERVAL_MINUTES,
      );
    }

    const bars: OhlcvBar[] = rows
      .map(([ts, open, high, low, close, volume]) => ({
        timestamp: new Date(ts),
        open,
        high,
        low,
        close,
        volume: volume ?? 0,
      }))
      .filter((b) => Number.isFinite(b.close) && !Number.isNaN(b.timestamp.getTime()))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    this.histories.set(symbol, bars.slice(-500));
  }

  private async pollLtp() {
    const keys = [...this.instruments.values()].map((i) => i.instrumentKey);
    if (!keys.length) return;

    const quotes = await this.client.getLtp(keys);
    for (const q of quotes) {
      const symbol = this.keyToSymbol.get(q.instrumentKey);
      if (!symbol || !Number.isFinite(q.lastPrice) || q.lastPrice <= 0) continue;

      const tick: Tick = {
        symbol,
        price: q.lastPrice,
        volume: q.volume ?? 0,
        timestamp: new Date(),
      };
      this.updateCandle(symbol, tick);
      this.emit("tick", tick);
    }
  }

  private updateCandle(symbol: string, tick: Tick) {
    const bucket = floorToCandleBucket(tick.timestamp, CANDLE_INTERVAL_MINUTES);
    let candle = this.candleBuilders.get(symbol);

    if (!candle || candle.timestamp.getTime() !== bucket.getTime()) {
      if (candle) {
        const hist = this.histories.get(symbol) ?? [];
        hist.push(candle);
        if (hist.length > 500) hist.shift();
        this.histories.set(symbol, hist);
      }
      candle = {
        timestamp: bucket,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume || 0,
      };
      this.candleBuilders.set(symbol, candle);
    } else {
      candle.high = Math.max(candle.high, tick.price);
      candle.low = Math.min(candle.low, tick.price);
      candle.close = tick.price;
      candle.volume += tick.volume || 0;
    }
  }
}
