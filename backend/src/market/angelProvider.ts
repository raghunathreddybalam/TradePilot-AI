import { EventEmitter } from "node:events";
import type { OhlcvBar, Tick } from "../types/market.js";
import type { MarketDataProvider } from "./provider.js";
import { CANDLE_INTERVAL_MINUTES, floorToCandleBucket } from "../config/timeframe.js";
import {
  AngelSmartApiClient,
  formatAngelDateTime,
  hasAngelCredentials,
} from "./angelClient.js";
import { resolveAngelInstrument, type AngelInstrument } from "./instruments.js";

/**
 * Angel One SmartAPI market data — free with an Angel One account.
 * Uses REST quote polling (1 req/sec, up to 50 tokens) + historical candles.
 * Keeps paper trading; does not place Angel orders.
 */
export class AngelMarketDataProvider extends EventEmitter implements MarketDataProvider {
  readonly name = "angel";
  private client = new AngelSmartApiClient();
  private pollTimer: NodeJS.Timeout | null = null;
  private instruments = new Map<string, AngelInstrument>();
  private tokenToSymbol = new Map<string, string>();
  private histories = new Map<string, OhlcvBar[]>();
  private candleBuilders = new Map<string, OhlcvBar>();
  private prices = new Map<string, number>();

  async start(symbols: string[]): Promise<void> {
    if (!hasAngelCredentials()) {
      throw new Error(
        "Angel credentials missing. Set ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_PASSWORD, ANGEL_TOTP_SECRET in backend/.env",
      );
    }

    for (const symbol of symbols) {
      const inst = resolveAngelInstrument(symbol);
      if (!inst) {
        console.warn(`[angel] No token mapping for ${symbol} — skipped`);
        continue;
      }
      this.instruments.set(symbol, inst);
      this.tokenToSymbol.set(inst.token, symbol);
    }

    await this.client.login();
    await this.bootstrapHistories();

    // Rate limit: 1 quote request per second
    this.pollTimer = setInterval(() => {
      void this.pollQuotes().catch((err) => console.error("[angel] poll error", err));
    }, 1100);

    console.log(`[angel] Streaming ${this.instruments.size} symbols via SmartAPI quotes`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async getHistory(symbol: string, _intervalMinutes: number, count: number): Promise<OhlcvBar[]> {
    const hist = this.histories.get(symbol) ?? [];
    if (hist.length >= Math.min(count, 30)) return hist.slice(-count);

    // Refresh from API if thin
    try {
      await this.fetchHistory(symbol, count);
    } catch (err) {
      console.warn(`[angel] history refresh failed for ${symbol}`, err);
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
        await this.fetchHistory(symbol, 120);
      } catch (err) {
        console.warn(`[angel] bootstrap history failed for ${symbol}:`, err);
        this.histories.set(symbol, []);
      }
    }
  }

  private async fetchHistory(symbol: string, count: number) {
    const inst = this.instruments.get(symbol);
    if (!inst) return;

    const to = new Date();
    const from = new Date(to.getTime() - Math.max(count, 60) * CANDLE_INTERVAL_MINUTES * 60_000);
    // Include prior session if market closed / early morning
    from.setHours(from.getHours() - 8);

    const rows = await this.client.getCandleData({
      exchange: inst.exchange,
      symboltoken: inst.token,
      interval: "FIVE_MINUTE",
      fromdate: formatAngelDateTime(from),
      todate: formatAngelDateTime(to),
    });

    const bars: OhlcvBar[] = rows.map(([ts, open, high, low, close, volume]) => ({
      timestamp: new Date(ts),
      open,
      high,
      low,
      close,
      volume: volume ?? 0,
    }));

    this.histories.set(symbol, bars.slice(-500));
    if (bars.length) {
      this.prices.set(symbol, bars[bars.length - 1]!.close);
    }
  }

  private async pollQuotes() {
    const byExchange: Record<string, string[]> = {};
    for (const inst of this.instruments.values()) {
      byExchange[inst.exchange] ??= [];
      if (!byExchange[inst.exchange]!.includes(inst.token)) {
        byExchange[inst.exchange]!.push(inst.token);
      }
    }

    const quotes = await this.client.getQuotes(byExchange);
    for (const q of quotes) {
      const symbol = this.tokenToSymbol.get(q.symbolToken);
      if (!symbol || q.ltp == null) continue;

      const price = Number(q.ltp);
      if (!Number.isFinite(price) || price <= 0) continue;

      this.prices.set(symbol, price);
      const tick: Tick = {
        symbol,
        price,
        volume: Number(q.tradeVolume ?? 0),
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
