import { ema } from "../indicators/engine.js";
import type { IndicatorSnapshot, OhlcvBar, TradeDecision } from "../types/market.js";
import { trailStepForSymbol } from "./trailingStop.js";

/** Only short setups for now (gap above EMA → touch). Buys are ignored. */
export const SELL_ONLY = true;

export interface StrategyContext {
  symbol: string;
  indicators: IndicatorSnapshot;
  /** Full OHLCV history (oldest → newest), including forming candle */
  bars: OhlcvBar[];
}

export interface SetupSignal {
  side: "BUY" | "SELL";
  setupIndex: number;
  confirmIndex: number;
  setupTime: Date;
  confirmTime: Date;
  entryPrice: number;
  stopLoss: number;
  setupEma: number;
  confirmEma: number;
  reason: string;
}

/** Candle range intersects EMA (wick or body touches the line) */
export function touchesEma(bar: OhlcvBar, emaValue: number): boolean {
  return bar.low <= emaValue && bar.high >= emaValue;
}

/** Entire candle strictly above EMA (no touch) */
export function aboveWithoutTouch(bar: OhlcvBar, emaValue: number): boolean {
  return bar.low > emaValue;
}

/** Entire candle strictly below EMA (no touch) */
export function belowWithoutTouch(bar: OhlcvBar, emaValue: number): boolean {
  return bar.high < emaValue;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildSignal(
  side: "BUY" | "SELL",
  setup: OhlcvBar,
  confirm: OhlcvBar,
  setupIdx: number,
  confirmIdx: number,
  setupEma: number,
  confirmEma: number,
  symbol: string,
): SetupSignal {
  const trailStep = trailStepForSymbol(symbol);
  if (side === "SELL") {
    const entry = setup.low;
    const stop = setup.high;
    return {
      side,
      setupIndex: setupIdx,
      confirmIndex: confirmIdx,
      setupTime: setup.timestamp,
      confirmTime: confirm.timestamp,
      entryPrice: round2(entry),
      stopLoss: round2(stop),
      setupEma,
      confirmEma,
      reason: [
        `SELL ${symbol}`,
        `setup above EMA(5)=${setupEma.toFixed(2)} (no touch)`,
        `next touched EMA(5)=${confirmEma.toFixed(2)}`,
        `entry=setup low ${entry.toFixed(2)}`,
        `SL=setup high ${stop.toFixed(2)}`,
        `exit=trail every ${trailStep}pts (no fixed TP)`,
      ].join(" | "),
    };
  }

  const entry = setup.high;
  const stop = setup.low;
  return {
    side,
    setupIndex: setupIdx,
    confirmIndex: confirmIdx,
    setupTime: setup.timestamp,
    confirmTime: confirm.timestamp,
    entryPrice: round2(entry),
    stopLoss: round2(stop),
    setupEma,
    confirmEma,
    reason: [
      `BUY ${symbol}`,
      `setup below EMA(5)=${setupEma.toFixed(2)} (no touch)`,
      `next touched EMA(5)=${confirmEma.toFixed(2)}`,
      `entry=setup high ${entry.toFixed(2)}`,
      `SL=setup low ${stop.toFixed(2)}`,
      `exit=trail every ${trailStep}pts (no fixed TP)`,
    ].join(" | "),
  };
}

/**
 * Scan completed bars for every EMA(5) gap→touch setup.
 * `bars` should be oldest→newest; forming candle may be included (last bar ignored if dropForming).
 */
export function findAllSetups(
  symbol: string,
  bars: OhlcvBar[],
  dropForming = true,
): SetupSignal[] {
  const completed = dropForming && bars.length > 0 ? bars.slice(0, -1) : bars;
  if (completed.length < 7) return [];

  const closes = completed.map((b) => b.close);
  const ema5Series = ema(closes, 5);
  const out: SetupSignal[] = [];

  for (let confirmIdx = 5; confirmIdx < completed.length; confirmIdx++) {
    const setupIdx = confirmIdx - 1;
    const setup = completed[setupIdx]!;
    const confirm = completed[confirmIdx]!;
    const setupEma = ema5Series[setupIdx];
    const confirmEma = ema5Series[confirmIdx];
    if (setupEma == null || confirmEma == null) continue;

    if (aboveWithoutTouch(setup, setupEma) && touchesEma(confirm, confirmEma)) {
      out.push(
        buildSignal("SELL", setup, confirm, setupIdx, confirmIdx, setupEma, confirmEma, symbol),
      );
    } else if (
      !SELL_ONLY &&
      belowWithoutTouch(setup, setupEma) &&
      touchesEma(confirm, confirmEma)
    ) {
      out.push(
        buildSignal("BUY", setup, confirm, setupIdx, confirmIdx, setupEma, confirmEma, symbol),
      );
    }
  }

  return out;
}

/**
 * Live decision = latest completed pair only (trail SL exit, no fixed TP).
 */
export function evaluateStrategy(ctx: StrategyContext): TradeDecision {
  const { symbol, indicators, bars } = ctx;
  const setups = findAllSetups(symbol, bars, true);
  const latest = setups[setups.length - 1];

  if (!latest) {
    return {
      action: "HOLD",
      confidence: 0.2,
      reason: `${symbol}: no EMA(5) gap→touch on last completed 5m pair`,
      indicators,
    };
  }

  // Only fire if the confirm candle is the latest completed bar
  const completed = bars.slice(0, -1);
  const lastCompleted = completed[completed.length - 1];
  if (!lastCompleted || lastCompleted.timestamp.getTime() !== latest.confirmTime.getTime()) {
    return {
      action: "HOLD",
      confidence: 0.2,
      reason: `${symbol}: last setup already aged — waiting for new gap→touch`,
      indicators,
    };
  }

  return {
    action: latest.side,
    confidence: 0.8,
    entryPrice: latest.entryPrice,
    stopLoss: latest.stopLoss,
    quantity: 1,
    reason: latest.reason,
    indicators,
  };
}
