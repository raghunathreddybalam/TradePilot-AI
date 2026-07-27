import type { OhlcvBar, Tick } from "../types/market.js";
import { EventEmitter } from "node:events";

export interface MarketDataProvider {
  readonly name: string;
  start(symbols: string[]): Promise<void>;
  stop(): Promise<void>;
  getHistory(symbol: string, intervalMinutes: number, count: number): Promise<OhlcvBar[]>;
  onTick(handler: (tick: Tick) => void): void;
  offTick(handler: (tick: Tick) => void): void;
}

/** Seed prices for Indian indices / liquid stocks (approx levels for demo) */
const SEED_PRICES: Record<string, number> = {
  "NIFTY 50": 24_500,
  "NIFTY BANK": 52_000,
  RELIANCE: 1_420,
  TCS: 3_850,
  INFY: 1_780,
  HDFCBANK: 1_680,
  SBIN: 820,
  "NIFTY": 24_500,
  "BANKNIFTY": 52_000,
};

/**
 * Simulated market data for paper trading without Zerodha credentials.
 * Generates random-walk ticks and builds 1-minute candles.
 */
export class MockMarketDataProvider extends EventEmitter implements MarketDataProvider {
  readonly name = "mock";
  private timers = new Map<string, NodeJS.Timeout>();
  private prices = new Map<string, number>();
  private histories = new Map<string, OhlcvBar[]>();
  private candleBuilders = new Map<string, OhlcvBar>();

  async start(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      const seed = SEED_PRICES[symbol] ?? 1000 + Math.random() * 500;
      this.prices.set(symbol, seed);
      this.histories.set(symbol, this.bootstrapHistory(symbol, seed));
      this.timers.set(
        symbol,
        setInterval(() => this.emitTick(symbol), 1000 + Math.floor(Math.random() * 500)),
      );
    }
    console.log(`[market:mock] Streaming ${symbols.length} symbols`);
  }

  async stop(): Promise<void> {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }

  async getHistory(symbol: string, _intervalMinutes: number, count: number): Promise<OhlcvBar[]> {
    const hist = this.histories.get(symbol) ?? [];
    return hist.slice(-count);
  }

  onTick(handler: (tick: Tick) => void): void {
    this.on("tick", handler);
  }

  offTick(handler: (tick: Tick) => void): void {
    this.off("tick", handler);
  }

  getPrice(symbol: string): number | undefined {
    return this.prices.get(symbol);
  }

  private emitTick(symbol: string) {
    const prev = this.prices.get(symbol) ?? 1000;
    const shock = (Math.random() - 0.5) * prev * 0.0008;
    const price = Math.max(1, Math.round((prev + shock) * 100) / 100);
    this.prices.set(symbol, price);

    const volume = Math.floor(50 + Math.random() * 200);
    const tick: Tick = { symbol, price, volume, timestamp: new Date() };
    this.updateCandle(symbol, tick);
    this.emit("tick", tick);
  }

  private updateCandle(symbol: string, tick: Tick) {
    const minute = new Date(tick.timestamp);
    minute.setSeconds(0, 0);
    const key = symbol;
    let candle = this.candleBuilders.get(key);

    if (!candle || candle.timestamp.getTime() !== minute.getTime()) {
      if (candle) {
        const hist = this.histories.get(symbol) ?? [];
        hist.push(candle);
        if (hist.length > 500) hist.shift();
        this.histories.set(symbol, hist);
      }
      candle = {
        timestamp: minute,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
      };
      this.candleBuilders.set(key, candle);
    } else {
      candle.high = Math.max(candle.high, tick.price);
      candle.low = Math.min(candle.low, tick.price);
      candle.close = tick.price;
      candle.volume += tick.volume;
    }
  }

  private bootstrapHistory(symbol: string, seed: number): OhlcvBar[] {
    const bars: OhlcvBar[] = [];
    let price = seed * (1 - 0.01);
    const now = Date.now();
    for (let i = 120; i >= 1; i--) {
      const drift = (Math.random() - 0.48) * seed * 0.001;
      const open = price;
      const close = Math.max(1, price + drift);
      const high = Math.max(open, close) + Math.random() * seed * 0.0005;
      const low = Math.min(open, close) - Math.random() * seed * 0.0005;
      bars.push({
        timestamp: new Date(now - i * 60_000),
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
        volume: Math.floor(5000 + Math.random() * 20000),
      });
      price = close;
    }
    this.prices.set(symbol, round2(price));
    return bars;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Zerodha market data provider stub.
 * Wire kiteconnect ticker here when API keys are available.
 */
export class ZerodhaMarketDataProvider extends EventEmitter implements MarketDataProvider {
  readonly name = "zerodha";

  async start(_symbols: string[]): Promise<void> {
    console.warn(
      "[market:zerodha] Provider stub — set USE_MOCK_MARKET_DATA=false and wire KiteTicker when ready",
    );
  }

  async stop(): Promise<void> {}

  async getHistory(_symbol: string, _intervalMinutes: number, _count: number): Promise<OhlcvBar[]> {
    return [];
  }

  onTick(handler: (tick: Tick) => void): void {
    this.on("tick", handler);
  }

  offTick(handler: (tick: Tick) => void): void {
    this.off("tick", handler);
  }
}
