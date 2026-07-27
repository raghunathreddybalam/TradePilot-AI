import { EventEmitter } from "node:events";
import type { OhlcvBar, Tick } from "../types/market.js";
import type { MarketDataProvider } from "./provider.js";
import { CANDLE_INTERVAL_MINUTES, floorToCandleBucket } from "../config/timeframe.js";
import { FivePaisaClient, hasFivePaisaCredentials } from "./fivepaisaClient.js";
import { resolveFivePaisa, type FivePaisaInstrument } from "./brokerInstruments.js";

/**
 * 5paisa free market-data provider (paper trading only).
 * Prefer FIVEPAISA_ACCESS_TOKEN + FIVEPAISA_CLIENT_CODE from Xstream portal.
 * Historical candles are bootstrapped from live ticks (no separate hist call in MVP).
 */
export class FivePaisaMarketDataProvider extends EventEmitter implements MarketDataProvider {
  readonly name = "fivepaisa";
  private client = new FivePaisaClient();
  private pollTimer: NodeJS.Timeout | null = null;
  private instruments = new Map<string, FivePaisaInstrument>();
  private codeToSymbol = new Map<number, string>();
  private histories = new Map<string, OhlcvBar[]>();
  private candleBuilders = new Map<string, OhlcvBar>();

  async start(symbols: string[]): Promise<void> {
    if (!hasFivePaisaCredentials()) {
      throw new Error(
        "5paisa credentials missing. Set FIVEPAISA_ACCESS_TOKEN + FIVEPAISA_CLIENT_CODE (recommended)",
      );
    }

    for (const symbol of symbols) {
      const inst = resolveFivePaisa(symbol);
      if (!inst) {
        console.warn(`[5paisa] No scrip mapping for ${symbol} — skipped`);
        continue;
      }
      this.instruments.set(symbol, inst);
      this.codeToSymbol.set(inst.scripCode, symbol);
      this.histories.set(symbol, []);
    }

    await this.client.login();

    this.pollTimer = setInterval(() => {
      void this.poll().catch((err) => console.error("[5paisa] poll error", err));
    }, 1200);

    console.log(`[5paisa] Streaming ${this.instruments.size} symbols`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async getHistory(symbol: string, _intervalMinutes: number, count: number): Promise<OhlcvBar[]> {
    return (this.histories.get(symbol) ?? []).slice(-count);
  }

  onTick(handler: (tick: Tick) => void): void {
    this.on("tick", handler);
  }

  offTick(handler: (tick: Tick) => void): void {
    this.off("tick", handler);
  }

  private async poll() {
    const scrips = [...this.instruments.values()].map((i) => ({
      Exch: i.exch,
      ExchType: i.exchType,
      ScripCode: i.scripCode,
    }));
    if (!scrips.length) return;

    const rows = await this.client.getMarketFeed(scrips);
    for (const row of rows) {
      const symbol = this.codeToSymbol.get(row.ScripCode);
      if (!symbol || !row.LastRate) continue;

      const tick: Tick = {
        symbol,
        price: row.LastRate,
        volume: row.TotalQty ?? 0,
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

      const hist = this.histories.get(symbol) ?? [];
      if (hist.length < 40) {
        const step = CANDLE_INTERVAL_MINUTES * 60_000;
        for (let i = 40 - hist.length; i > 0; i--) {
          const ts = new Date(bucket.getTime() - i * step);
          hist.push({
            timestamp: ts,
            open: tick.price,
            high: tick.price,
            low: tick.price,
            close: tick.price,
            volume: 0,
          });
        }
        this.histories.set(symbol, hist);
      }
    } else {
      candle.high = Math.max(candle.high, tick.price);
      candle.low = Math.min(candle.low, tick.price);
      candle.close = tick.price;
      candle.volume += tick.volume || 0;
    }
  }
}
